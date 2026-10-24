// PDF-звіт «Мій список ігор»: скільки коштують ігри зараз, скільки без знижок і скільки можна заощадити.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { PdfDocument } from '../formats/pdf.js';
import { getUsdRate } from '../stores/currency.js';
import { formatUah } from '../stores/util.js';
import { listWatch, summarizeWatch } from './watch.js';

const FONT_DIR = path.join(ROOT, 'server', 'assets', 'fonts');
const C = {
  ink: '#121826',
  muted: '#5a6478',
  line: '#d8deea',
  soft: '#f2f4f8',
  dark: '#0c111d',
  accent: '#f29a2e',
  onAccent: '#1f1304',
  good: '#137a39',
  goodBg: '#dcf4e3',
  steam: '#1f6fb2',
  gog: '#8a3fd1',
};
const M = 40; // поля сторінки

const dateTime = (d) => d.toLocaleString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const money = (kopecks) => (kopecks == null ? '—' : formatUah(kopecks));

/** Обкладинки качаємо паралельно; що не встигло за кілька секунд — замінюємо заглушкою. */
async function loadCovers(urls, { timeoutMs = 4000 } = {}) {
  const result = new Map();
  await Promise.all(
    [...new Set(urls.filter(Boolean))].map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) result.set(url, Buffer.from(await res.arrayBuffer()));
      } catch {
        // без цієї обкладинки
      }
    })
  );
  return result;
}

const conditionText = (item) =>
  [
    item.minDiscount ? `знижка від ${item.minDiscount}%` : null,
    item.maxPriceUah != null ? `ціна до ${formatUah(item.maxPriceUah)}` : null,
    item.notifyFree ? 'роздача' : null,
  ]
    .filter(Boolean)
    .join(', ');

export async function buildReport(user, { covers = true } = {}) {
  const items = listWatch(user.id);
  const s = summarizeWatch(items);
  const created = new Date();
  const doc = new PdfDocument({ title: `Знижколов — звіт про список ігор (${user.name})`, author: user.name });
  doc.addFont('regular', fs.readFileSync(path.join(FONT_DIR, 'Manrope-400Regular.ttf')), 'Manrope-Regular');
  doc.addFont('bold', fs.readFileSync(path.join(FONT_DIR, 'Manrope-700Bold.ttf')), 'Manrope-Bold');

  const coverData = covers ? await loadCovers(items.map((i) => i.imageUrl)) : new Map();
  const imageKeys = new Map();
  for (const [url, buf] of coverData) {
    const key = doc.addJpeg(buf);
    if (key) imageKeys.set(url, key);
  }

  // ---- Перша сторінка: шапка і підсумок ----
  let page = doc.addPage();
  const W = page.width;
  page.rect(0, 0, W, 104, { fill: C.dark });
  page.rect(M, 30, 34, 34, { fill: C.accent, radius: 8 });
  page.text('%', M + 17, 54, { font: 'bold', size: 20, color: C.onAccent, align: 'center' });
  page.text('Знижколов', M + 46, 50, { font: 'bold', size: 22, color: '#ffffff' });
  page.text('Звіт про список ігор', M + 46, 70, { size: 11, color: '#c5cde0' });
  page.text(user.name, W - M, 50, { font: 'bold', size: 12, color: '#ffffff', align: 'right', maxWidth: 220 });
  page.text(`Сформовано ${dateTime(created)}`, W - M, 68, { size: 9, color: '#c5cde0', align: 'right' });

  const cards = [
    ['Ігор у списку', String(items.length), C.ink],
    ['Найкраща ціна зараз', money(s.now), C.ink],
    ['Без знижок коштували б', money(s.regular), C.ink],
    ['Можна заощадити', money(s.savings), C.good],
  ];
  const gap = 10;
  const cardW = (W - M * 2 - gap * 3) / 4;
  cards.forEach(([label, value, color], i) => {
    const x = M + i * (cardW + gap);
    page.rect(x, 124, cardW, 62, { fill: C.soft, radius: 8 });
    page.text(label, x + 12, 144, { size: 8.5, color: C.muted, maxWidth: cardW - 20 });
    page.text(value, x + 12, 170, { font: 'bold', size: 16, color, maxWidth: cardW - 20 });
  });
  page.text(
    items.length
      ? `Умову сповіщення зараз виконано для ${s.met} з ${items.length} ігор. Ціна для кожної гри — найнижча серед Steam і GOG.`
      : 'Список поки порожній: додай ігри на сайті, і звіт покаже їхні ціни та знижки.',
    M,
    208,
    { size: 9.5, color: C.muted }
  );

  // ---- Таблиця ----
  const cols = [
    { key: 'game', title: 'Гра', x: M, w: 218 },
    { key: 'steam', title: 'Steam', x: M + 218, w: 64, align: 'right' },
    { key: 'gog', title: 'GOG', x: M + 282, w: 64, align: 'right' },
    { key: 'best', title: 'Найкраща', x: M + 346, w: 66, align: 'right' },
    { key: 'disc', title: 'Знижка', x: M + 412, w: 46, align: 'right' },
    { key: 'status', title: 'Статус', x: M + 466, w: 49 },
  ];
  const ROW = 40;
  const header = (y) => {
    page.rect(M, y, W - M * 2, 22, { fill: C.soft, radius: 4 });
    for (const c of cols) {
      page.text(c.title, c.align === 'right' ? c.x + c.w - 6 : c.x + 8, y + 15, { font: 'bold', size: 8.5, color: C.muted, align: c.align || 'left' });
    }
    return y + 26;
  };
  let y = header(226);
  const bottomLimit = page.height - 56;

  s.rows.forEach((r, index) => {
    if (y + ROW > bottomLimit) {
      page = doc.addPage();
      y = header(M);
    }
    if (index % 2 === 1) page.rect(M, y - 2, W - M * 2, ROW, { fill: '#fafbfd' });

    // Обкладинка або заглушка з першими літерами
    const coverX = M + 6;
    const coverY = y + 5;
    const key = imageKeys.get(r.item.imageUrl);
    if (key) page.clip(coverX, coverY, 72, 27, () => page.image(key, coverX, coverY, 72, 27));
    else {
      page.rect(coverX, coverY, 72, 27, { fill: C.soft, radius: 4 });
      page.text(r.item.title.slice(0, 2).toUpperCase(), coverX + 36, coverY + 18, { font: 'bold', size: 10, color: C.muted, align: 'center' });
    }
    const textX = coverX + 80;
    page.text(r.item.title, textX, y + 16, { font: 'bold', size: 9.5, color: C.ink, maxWidth: cols[0].w - 92 });
    page.text(`умова: ${conditionText(r.item) || '—'}`, textX, y + 29, { size: 7.5, color: C.muted, maxWidth: cols[0].w - 92 });

    const cell = (c, value, opts = {}) =>
      page.text(value, c.align === 'right' ? c.x + c.w - 6 : c.x + 8, y + 22, { size: 9, color: C.ink, align: c.align || 'left', ...opts });
    const priceOf = (o) => (!o ? '—' : !o.available || o.priceUah == null ? 'немає' : `${o.currency === 'USD' ? '≈' : ''}${money(o.priceUah)}`);
    cell(cols[1], priceOf(r.steam), { color: r.best?.store === 'steam' ? C.ink : C.muted });
    cell(cols[2], priceOf(r.gog), { color: r.best?.store === 'gog' ? C.ink : C.muted });
    cell(cols[3], r.best ? money(r.best.priceUah) : '—', { font: 'bold' });
    cell(cols[4], r.best?.discount ? `−${r.best.discount}%` : '—', { color: r.best?.discount ? C.good : C.muted, font: r.best?.discount ? 'bold' : 'regular' });

    // Статус кольоровою «пігулкою»
    const st = !r.item.active ? ['Пауза', C.soft, C.muted] : r.item.conditionMet ? ['Виконано', C.goodBg, C.good] : ['Чекаємо', C.soft, C.muted];
    page.rect(cols[5].x + 1, y + 11, 48, 16, { fill: st[1], radius: 8 });
    page.text(st[0], cols[5].x + 25, y + 22.5, { font: 'bold', size: 7.5, color: st[2], align: 'center' });

    page.line(M, y + ROW - 2, W - M, y + ROW - 2, { color: C.line, width: 0.5 });
    y += ROW;
  });

  if (s.rows.some((r) => r.gog)) {
    if (y + 24 > bottomLimit) {
      page = doc.addPage();
      y = M;
    }
    page.text(`Ціни GOG перераховано в гривні за курсом НБУ: 1 $ = ${getUsdRate().rate.toFixed(2).replace('.', ',')} грн.`, M, y + 16, { size: 8, color: C.muted });
  }

  // ---- Нижній колонтитул на кожній сторінці (тепер відомо, скільки їх) ----
  doc.pages.forEach((p, i) => {
    p.line(M, p.height - 36, p.width - M, p.height - 36, { color: C.line, width: 0.5 });
    p.text(`Знижколов · ${config.baseUrl}`, M, p.height - 22, { size: 8, color: C.muted });
    p.text(`Сторінка ${i + 1} з ${doc.pages.length}`, p.width - M, p.height - 22, { size: 8, color: C.muted, align: 'right' });
  });

  return doc.toBuffer();
}
