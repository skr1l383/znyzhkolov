// Експорт списку ігор у CSV/Excel та імпорт списку з таких файлів.
import { HttpError, templateError } from '../http.js';
import { toCsv, parseCsv, decodeText } from '../formats/csv.js';
import { detectTable } from '../formats/detect.js';
import { parseXlsx, toXlsx } from '../formats/xlsx.js';
import { store } from '../stores/index.js';
import { normalizeTitle, numberWords, titleScore } from '../stores/match.js';
import { steamUrl } from '../stores/steam.js';
import { sleep } from '../stores/util.js';
import { config } from '../config.js';
import { getUsdRate, toUah } from '../stores/currency.js';
import { listWatch } from './watch.js';

export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_MAX_ROWS = 50;
export const IMPORT_DEFAULT_DISCOUNT = 50;

const HEADER = [
  'Назва',
  'Steam ID',
  'GOG ID',
  'Ціна Steam, грн',
  'Ціна GOG, грн',
  'Найкраща ціна, грн',
  'Знижка зараз, %',
  'Умова: знижка від, %',
  'Умова: ціна до, грн',
  'Сповіщати про безкоштовну роздачу',
  'Стеження увімкнено',
  'Посилання Steam',
  'Посилання GOG',
];
const WIDTHS = [36, 11, 13, 15, 14, 18, 15, 20, 18, 22, 18, 42, 50];

const uah = (kopecks) => (kopecks == null ? null : kopecks / 100);

// ---------- Експорт ----------

export function exportRows(userId) {
  const rows = listWatch(userId).map((item) => {
    const steam = item.offers.find((o) => o.store === 'steam');
    const gog = item.offers.find((o) => o.store === 'gog');
    const best = item.offers.find((o) => o.store === item.bestStore);
    const discount = Math.max(0, ...item.offers.filter((o) => o.available).map((o) => o.discount || 0));
    return [
      item.title,
      steam?.storeId ?? '',
      gog?.storeId ?? '',
      uah(steam?.priceUah),
      uah(gog?.priceUah),
      uah(best?.priceUah),
      discount,
      item.minDiscount ?? '',
      uah(item.maxPriceUah) ?? '',
      item.notifyFree,
      item.active,
      steam?.url ?? '',
      gog?.url ?? '',
    ];
  });
  return [HEADER, ...rows];
}

export function exportFile(userId, format) {
  const rows = exportRows(userId);
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    return {
      buffer: toXlsx(rows, { sheetName: 'Мій список', widths: WIDTHS }),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `znyzhkolov-${date}.xlsx`,
      count: rows.length - 1,
    };
  }
  return {
    buffer: Buffer.from(toCsv(rows), 'utf8'),
    type: 'text/csv; charset=utf-8',
    filename: `znyzhkolov-${date}.csv`,
    count: rows.length - 1,
  };
}

// ---------- Імпорт: файл → рядки ----------

/** Байти файлу → масив рядків таблиці. Формат визначаємо за вмістом, а не за назвою файлу. */
export function readTable(buffer) {
  const kind = detectTable(buffer);
  if (kind === 'xlsx') {
    try {
      return parseXlsx(buffer);
    } catch (err) {
      throw templateError(415, 'Не вдалося прочитати файл Excel: {error}', { error: err.message });
    }
  }
  if (kind === 'csv') return parseCsv(decodeText(buffer));
  if (kind === 'xls') throw new HttpError(415, 'Старий формат Excel (.xls) не підтримується. Збережи файл як .xlsx або .csv');
  throw new HttpError(415, 'Формат не підтримується. Можна імпортувати таблицю CSV або Excel (.xlsx)');
}

const COLUMN_RULES = [
  // Лише точна назва стовпця: інакше гра «Game Dev Tycoon» у першому рядку здавалася б заголовком
  ['title', /^(назва( гри)?|гра|title|name|game( title| name)?)$/],
  ['steamId', /steam/],
  ['gogId', /gog/],
  ['minDiscount', /знижка від|min.*discount|discount.*from/],
  ['maxPrice', /ціна до|max.*price|price.*to/],
  ['notifyFree', /безкоштов|free/],
  ['active', /стеження|active|enabled/],
];

/** Номери стовпців за назвами в заголовку. Посилання й ціни магазинів не плутаємо з їхніми ID. */
function mapHeader(header) {
  const map = {};
  header.forEach((cell, i) => {
    const h = String(cell).trim().toLowerCase();
    if (/ціна steam|ціна gog|price|посилання|link|url|найкраща|зараз/.test(h) && !/ціна до|max/.test(h)) return;
    for (const [key, re] of COLUMN_RULES) {
      if (map[key] == null && re.test(h)) {
        map[key] = i;
        break;
      }
    }
  });
  return map;
}

const YES = /^(так|yes|true|1|\+|y|t)$/i;
const NO = /^(ні|no|false|0|-|n|f)$/i;
const toBool = (v, fallback) => (YES.test(String(v).trim()) ? true : NO.test(String(v).trim()) ? false : fallback);

function toNumber(v) {
  const s = String(v ?? '').replace(/[\s ₴%]|грн/gi, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Рядки таблиці → записи для імпорту з номером рядка у файлі (для звіту).
 * Якщо в першому рядку немає заголовка «Назва», вважаємо, що це просто список назв у першому стовпці.
 */
export function parseImportRows(table) {
  if (!table.length) throw new HttpError(400, 'Файл порожній');
  const map = mapHeader(table[0]);
  const hasHeader = map.title != null;
  if (!hasHeader) map.title = 0;
  const body = (hasHeader ? table.slice(1) : table).map((row, i) => ({ row, line: i + (hasHeader ? 2 : 1) }));
  const nonEmpty = body.filter(({ row }) => row.some((c) => String(c).trim()));
  if (!nonEmpty.length) throw new HttpError(400, 'У файлі немає жодної гри');
  if (nonEmpty.length > IMPORT_MAX_ROWS) {
    throw templateError(400, 'Забагато рядків: {rows}. За один раз можна імпортувати до {max} ігор', { rows: nonEmpty.length, max: IMPORT_MAX_ROWS });
  }

  return nonEmpty.map(({ row, line }) => {
    const cell = (key) => (map[key] == null ? '' : String(row[map[key]] ?? '').trim());
    const problems = [];
    // Steam ID беремо зі стовпця або з посилання на сторінку гри в будь-якій клітинці
    const linkId = row.map((c) => /store\.steampowered\.com\/app\/(\d+)/.exec(String(c))?.[1]).find(Boolean);
    const steamId = /^\d{1,12}$/.test(cell('steamId')) ? cell('steamId') : linkId || null;
    const gogId = /^\d{1,12}$/.test(cell('gogId')) ? cell('gogId') : null;

    let minDiscount = toNumber(cell('minDiscount'));
    if (Number.isNaN(minDiscount) || (minDiscount != null && (minDiscount < 1 || minDiscount > 100))) {
      problems.push('знижку від % пропущено: має бути числом від 1 до 100');
      minDiscount = null;
    }
    let maxPrice = toNumber(cell('maxPrice'));
    if (Number.isNaN(maxPrice) || (maxPrice != null && (maxPrice < 0 || maxPrice > 100000))) {
      problems.push('ціну до пропущено: має бути числом від 0 до 100000');
      maxPrice = null;
    }
    // Без жодної умови стежити немає сенсу — ставимо типову «знижка від 50%»
    if (minDiscount == null && maxPrice == null) minDiscount = IMPORT_DEFAULT_DISCOUNT;

    return {
      line,
      title: cell('title').slice(0, 200),
      steamId,
      gogId,
      conditions: {
        min_discount: minDiscount == null ? null : Math.round(minDiscount),
        max_price_uah: maxPrice == null ? null : Math.round(maxPrice * 100),
        notify_free: toBool(cell('notifyFree'), true) ? 1 : 0,
        active: toBool(cell('active'), true) ? 1 : 0,
      },
      problems,
    };
  });
}

// ---------- Імпорт: пошук ігор у магазинах ----------

/**
 * Найкращий результат пошуку для назви, яку ввела людина.
 * Спершу — схожі назви; якщо таких немає (людина написала коротко: «Witcher 3»),
 * беремо назви, що містять запит, і з них — найдорожчу: основна гра майже завжди дорожча
 * за свої доповнення, саундтреки й безкоштовні інструменти (The Witcher 3 REDkit).
 */
export function pickResult(query, results) {
  const q = normalizeTitle(query);
  if (!q) return null;
  // 1 — та сама назва, 0.9 — та сама з «Edition»/«Final Cut»; решта схожих назв далі вибираються за ціною
  const exact = (r) => (r.score >= 0.9 ? r.score : 0);
  return (
    results
      .map((r, order) => ({ ...r, order, score: titleScore(query, r.title) }))
      .filter((r) => r.score >= 0.5 || (normalizeTitle(r.title).includes(q) && sameSeriesPart(query, r.title)))
      .sort((a, b) => exact(b) - exact(a) || (b.price || 0) - (a.price || 0) || a.order - b.order)[0] || null
  );
}

/**
 * «Hades» ≠ «Hades II» і «Witcher 2» ≠ «Witcher 3», але «Cyberpunk» = «Cyberpunk 2077»:
 * числа від трьох цифр — це частина назви, а не номер частини серії.
 */
function sameSeriesPart(query, title) {
  if (numberWords(query) === numberWords(title)) return true;
  return !numberWords(query) && numberWords(title).split(',').every((n) => /^\d{3,}$/.test(n));
}

/** Запис імпорту → пропозиції магазинів (перша — основна). Порожній масив, якщо гру не знайдено. */
export async function resolveEntry(entry) {
  const offers = [];
  // Англійські назви в Steam, щоб зіставлення з GOG працювало так само, як для назви з файлу
  const steamResults = await store('steam').search(entry.title, { language: 'english' });
  let steam = entry.steamId ? steamResults.find((r) => r.storeId === entry.steamId) : pickResult(entry.title, steamResults);
  if (!steam && entry.steamId) {
    // ID відомий точно, а ціну підтягне перша ж перевірка
    steam = { store: 'steam', storeId: entry.steamId, title: entry.title, url: steamUrl(entry.steamId), imageUrl: null, price: null };
  }
  if (steam) offers.push(steam);

  if (!config.demoStores) await sleep(300); // не засипаємо магазини запитами
  const gogResults = await store('gog').search(steam?.title || entry.title);
  let gog = entry.gogId
    ? gogResults.find((r) => r.storeId === entry.gogId)
    : pickResult(steam?.title || entry.title, gogResults) || (steam ? pickResult(entry.title, gogResults) : null);
  if (!gog && entry.gogId) {
    gog = { store: 'gog', storeId: entry.gogId, title: entry.title, url: 'https://www.gog.com/', imageUrl: null, price: null };
  }
  if (gog) offers.push(gog);
  return offers;
}

// ---------- Заповнена таблиця ----------

/** Назви, введені вручну на сайті → записи для пошуку (як рядки імпорту без умов). */
export function entriesFromTitles(titles) {
  const list = (Array.isArray(titles) ? titles : []).map((t) => String(t ?? '').trim().slice(0, 200)).filter(Boolean);
  if (!list.length) throw new HttpError(400, 'Додай хоча б одну гру');
  if (list.length > IMPORT_MAX_ROWS) throw templateError(400, 'За один раз можна до {max} ігор', { max: IMPORT_MAX_ROWS });
  return list.map((title, i) => ({
    line: i + 1,
    title,
    steamId: null,
    gogId: null,
    conditions: { min_discount: IMPORT_DEFAULT_DISCOUNT, max_price_uah: null, notify_free: 1, active: 1 },
    problems: [],
  }));
}

const FILLED_HEADER = [
  'Рядок',
  'Запит',
  'Знайдена гра',
  'Steam ID',
  'GOG ID',
  'Ціна Steam, грн',
  'Ціна GOG, грн',
  'Найкраща ціна, грн',
  'Де дешевше',
  'Знижка зараз, %',
  'Посилання Steam',
  'Посилання GOG',
  'Статус',
];
const FILLED_WIDTHS = [7, 28, 36, 11, 13, 15, 14, 18, 12, 15, 42, 50, 22];

/**
 * Результати пошуку → таблиця для завантаження (Excel або CSV) у вигляді base64,
 * щоб її можна було віддати разом зі звітом в одній відповіді.
 * results: [{ line, title, offers: [...], status }]
 */
export function filledTable(results, format = 'xlsx') {
  const rate = getUsdRate().rate;
  const rows = results.map((r) => {
    const by = (s) => r.offers?.find((o) => o.store === s);
    const steam = by('steam');
    const gog = by('gog');
    const uahOf = (o) => (o && o.price != null ? toUah(o.price, o.currency, rate) : null);
    const priced = [steam, gog].filter((o) => uahOf(o) != null).sort((a, b) => uahOf(a) - uahOf(b));
    const best = priced[0];
    return [
      r.line,
      r.title,
      r.offers?.[0]?.title ?? '',
      steam?.storeId ?? '',
      gog?.storeId ?? '',
      uah(uahOf(steam)),
      uah(uahOf(gog)),
      uah(uahOf(best)),
      best ? (best.store === 'steam' ? 'Steam' : 'GOG') : '',
      priced.length ? Math.max(...priced.map((o) => o.discount || 0)) : '',
      steam?.url ?? '',
      gog?.url ?? '',
      r.status,
    ];
  });
  const table = [FILLED_HEADER, ...rows];
  const date = new Date().toISOString().slice(0, 10);
  const buffer =
    format === 'csv' ? Buffer.from(toCsv(table), 'utf8') : toXlsx(table, { sheetName: 'Ціни', widths: FILLED_WIDTHS });
  return {
    name: `znyzhkolov-ціни-${date}.${format === 'csv' ? 'csv' : 'xlsx'}`,
    type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buffer.toString('base64'),
  };
}
