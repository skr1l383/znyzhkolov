// ШІ-порадник: кнопка в правому нижньому куті й чат, доступний на кожній сторінці.
// На сторінці гри порадник знає, про яку гру мова («Купувати зараз чи чекати?»), деінде — радить, що вигідно,
// схожі ігри, що брати зі свого списку. Розмова зберігається до закриття вкладки (sessionStorage).
// Відповідь моделі показується лише через екранування (html``): посиланнями стають тільки ігри сайту.
import { post } from './api.js';
import { getLang, locale, t, tp } from './i18n.js';
import { go, state } from './app.js';
import { $, gameHref, html, raw, setHtml } from './ui.js';

const STORE_KEY = 'zk-advisor';
const TOOL_NAMES = {
  get_game_prices: 'ціни',
  get_price_history: 'історія цін',
  get_steam_key_offers: 'ключі Steam',
  search_deals: 'вітрина знижок',
  search_store: 'пошук у Steam',
  get_my_watchlist: 'мій список',
};

// Іконка порадника: бульбашка розмови з іскрою всередині (колір — currentColor, тож пасує до будь-якої теми)
export const ADVISOR_ICON = `<svg class="advisor-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path class="advisor-icon-bubble" d="M12 3.5c4.7 0 8.5 3.3 8.5 7.5s-3.8 7.5-8.5 7.5c-1 0-2-.15-2.9-.43L4.5 20l1.2-3.7C4.3 14.9 3.5 13 3.5 11c0-4.2 3.8-7.5 8.5-7.5Z" />
  <path class="advisor-icon-spark" d="M12 6.8c.38 2.3 1.6 3.55 3.9 3.95-2.3.4-3.52 1.65-3.9 3.95-.38-2.3-1.6-3.55-3.9-3.95 2.3-.4 3.52-1.65 3.9-3.95Z" />
  <path class="advisor-icon-spark is-small" d="M17.6 2.2c.17 1 .7 1.55 1.7 1.72-1 .17-1.53.72-1.7 1.72-.17-1-.7-1.55-1.7-1.72 1-.17 1.53-.72 1.7-1.72Z" />
</svg>`;
const CLOSE_ICON = '<svg class="advisor-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';

let messages = load(); // { role: 'user' | 'model' | 'error', text, meta? }
let game = null; // гра, на сторінці якої людина зараз: { store, storeId, title }
let busy = false;
let mounted = false;
let shownLang = null;

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(saved) ? saved.slice(-30) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    // без sessionStorage розмова живе до перезавантаження сторінки
  }
}

// ---- Текст відповіді: абзаци, пункти, **жирний** і посилання на ігри [Назва](steam:123) ----

const TOKENS = /\*\*(.+?)\*\*|\[([^\]]{1,120})\]\((steam|gog):(\d{1,12})\)/g;

function inline(line) {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(TOKENS)) {
    out.push(line.slice(last, m.index));
    if (m[1] != null) out.push(html`<b>${inline(m[1])}</b>`);
    else out.push(html`<a href="${gameHref(m[3], m[4])}" data-advisor-link>${m[2]}</a>`);
    last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

function answerHtml(text) {
  const blocks = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const item = line.match(/^(?:[•*-]|\d+[.)])\s+(.*)/);
    const last = blocks.at(-1);
    if (item) {
      if (last?.list) last.items.push(item[1]);
      else blocks.push({ list: true, items: [item[1]] });
    } else {
      blocks.push({ text: line });
    }
  }
  return blocks.map((b) => (b.list ? html`<ul>${b.items.map((x) => html`<li>${inline(x)}</li>`)}</ul>` : html`<p>${inline(b.text)}</p>`));
}

function metaLine(r) {
  const tools = [...new Set(r.tools)].map((x) => t(TOOL_NAMES[x] || x));
  return html`<p class="advisor-meta">
    <span title="${t('Модель, що відповіла')}">${r.model}${r.fallback ? html` · ${t('запасна модель')}` : ''}</span>
    <span title="${t('Вхід {prompt} · відповідь {output} · міркування {thoughts}', {
      prompt: r.usage.prompt.toLocaleString(locale()),
      output: r.usage.output.toLocaleString(locale()),
      thoughts: r.usage.thoughts.toLocaleString(locale()),
    })}">${r.usage.total.toLocaleString(locale())} ${tp(r.usage.total, 'токен', 'токени', 'токенів')}</span>
    ${tools.length ? html`<span>${t('Перевірив: {list}', { list: tools.join(', ') })}</span>` : ''}
    <span>${(r.ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${t('с')}</span>
  </p>`;
}

function messageHtml(m) {
  if (m.role === 'user') return html`<div class="advisor-msg is-user">${m.text}</div>`;
  if (m.role === 'error') return html`<div class="advisor-msg is-error" role="alert">${m.text}</div>`;
  return html`<div class="advisor-msg is-ai">${answerHtml(m.text)}${m.meta ? metaLine(m.meta) : ''}</div>`;
}

// ---- Підказки-кнопки: на сторінці гри — про цю гру, деінде — загальні ----

function chips() {
  if (game) {
    return [
      { label: 'Купувати зараз чи чекати?', question: '' },
      { label: 'Схожі ігри зі знижкою', question: 'Порадь схожі ігри, на які зараз є знижка' },
      { label: 'Чи бувала дешевшою?', question: 'Чи бувала ця гра дешевшою і коли чекати наступну знижку?' },
    ];
  }
  return [
    { label: 'Що зараз вигідно купити?', question: 'Що зараз найвигідніше купити зі знижкою?' },
    { label: 'Гра до 200 ₴', question: 'Порадь хорошу гру до 200 гривень' },
    { label: 'Що з мого списку брати?', question: 'Що з мого списку варто купити зараз, а що краще почекати?' },
  ];
}

// ---- Вікно чату ----

function renderFrame() {
  const panel = $('#advisor-panel');
  shownLang = getLang();
  setHtml(
    panel,
    html`
      <header class="advisor-top">
        <span class="advisor-badge">${raw(ADVISOR_ICON)}</span>
        <div class="advisor-title">
          <h2 id="advisor-title">${t('ШІ-порадник')}</h2>
          <p id="advisor-context"></p>
        </div>
        <button class="icon-btn" type="button" id="advisor-clear" title="${t('Нова розмова')}" aria-label="${t('Нова розмова')}">
          <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
        </button>
        <button class="icon-btn" type="button" id="advisor-close" aria-label="${t('Закрити')}">×</button>
      </header>
      <div class="advisor-log" id="advisor-log" aria-live="polite"></div>
      <div class="advisor-chips" id="advisor-chips"></div>
      ${state.user
        ? html`<form class="advisor-form" id="advisor-form">
            <input class="input" name="q" maxlength="500" autocomplete="off" placeholder="${t('Напиши питання…')}" aria-label="${t('Питання порадникові')}" />
            <button class="btn btn-primary" type="submit" aria-label="${t('Надіслати')}">
              <svg class="btn-icon" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
            </button>
          </form>`
        : html`<div class="advisor-guest">
            <p class="hint">${t('Увійди в акаунт, щоб поговорити з порадником.')}</p>
            <a class="btn btn-primary btn-block" href="#/login" data-advisor-link>${t('Увійти')}</a>
          </div>`}
    `
  );
  renderBody();
}

function renderBody() {
  const panel = $('#advisor-panel');
  if (!panel || panel.hidden) return;
  $('#advisor-context').textContent = game ? t('Про гру: {title}', { title: game.title }) : t('Знижки, ціни й рекомендації');
  const log = $('#advisor-log');
  setHtml(
    log,
    html`<div class="advisor-msg is-ai">
        <p>${t('Привіт! Я підкажу, чи варто купувати гру зараз, знайду схожі ігри зі знижкою або щось під твій бюджет.')}</p>
      </div>
      ${messages.map(messageHtml)}
      ${busy ? html`<div class="advisor-msg is-thinking"><span class="advisor-dots" aria-hidden="true"></span>${t('Перевіряю ціни й історію знижок…')}</div>` : ''}`
  );
  log.scrollTop = log.scrollHeight;
  setHtml(
    $('#advisor-chips'),
    state.user && !busy ? chips().map((c, i) => html`<button class="chip advisor-chip" type="button" data-chip="${i}">${t(c.label)}</button>`) : ''
  );
  const form = $('#advisor-form');
  if (form) form.querySelector('button').disabled = busy;
}

function setOpen(open) {
  const panel = $('#advisor-panel');
  if (!panel) return;
  panel.hidden = !open;
  $('#advisor-fab').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('advisor-open', open);
  if (open) {
    renderFrame();
    $('#advisor-form input')?.focus({ preventScroll: true });
  }
}

async function send(question, shownText) {
  if (busy || !state.user) return;
  messages.push({ role: 'user', text: shownText || question });
  busy = true;
  renderBody();
  // Попередні репліки для контексту (без помилок і без щойно доданої)
  const history = messages
    .slice(0, -1)
    .filter((m) => m.role !== 'error')
    .slice(-6)
    .map((m) => ({ role: m.role, text: m.text }));
  try {
    const r = await post('/api/advisor', {
      ...(game ? { store: game.store, id: game.storeId } : {}),
      question,
      history,
      lang: getLang(),
    });
    messages.push({ role: 'model', text: r.answer, meta: { model: r.model, fallback: r.fallback, usage: r.usage, tools: r.tools, ms: r.ms } });
  } catch (err) {
    // ШІ недоступний (ліміт, перевантаження) — пояснюємо, а решта сайту працює як була
    messages.push({ role: 'error', text: err.message });
  } finally {
    busy = false;
    save();
    renderBody();
  }
}

/** Створює кнопку й вікно (один раз) і ховає їх, якщо порадник на сервері не налаштований. */
export function syncAdvisor() {
  if (!mounted) {
    mounted = true;
    document.body.insertAdjacentHTML(
      'beforeend',
      String(html`<button class="advisor-fab" type="button" id="advisor-fab" aria-expanded="false" aria-controls="advisor-panel">
          <span class="advisor-fab-open">${raw(ADVISOR_ICON)}</span><span class="advisor-fab-close">${raw(CLOSE_ICON)}</span>
        </button>
        <section class="advisor-panel" id="advisor-panel" role="dialog" aria-labelledby="advisor-title" hidden></section>`)
    );
    $('#advisor-fab').addEventListener('click', () => setOpen($('#advisor-panel').hidden));
    const panel = $('#advisor-panel');
    panel.addEventListener('click', (e) => {
      if (e.target.closest('#advisor-close')) return setOpen(false);
      if (e.target.closest('#advisor-clear')) {
        messages = [];
        save();
        return renderBody();
      }
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const c = chips()[Number(chip.dataset.chip)];
        return send(c.question && t(c.question), t(c.label));
      }
      // Перехід на сторінку гри з відповіді: на телефоні вікно займає весь екран, тож закриваємо його
      if (e.target.closest('[data-advisor-link]') && matchMedia('(max-width: 600px)').matches) setOpen(false);
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.elements.q;
      const q = input.value.trim();
      if (!q || busy) return;
      input.value = '';
      send(q);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) setOpen(false);
    });
  }
  const enabled = Boolean(state.app?.ai);
  const fab = $('#advisor-fab');
  fab.hidden = !enabled;
  fab.setAttribute('aria-label', t('ШІ-порадник'));
  fab.title = t('ШІ-порадник');
  if (!enabled) setOpen(false);
  // Змінилася мова або людина увійшла/вийшла — перемальовуємо відкрите вікно
  else if (!$('#advisor-panel').hidden && (shownLang !== getLang() || Boolean($('#advisor-form')) !== Boolean(state.user))) renderFrame();
}

/** Сторінка гри повідомляє, про яку гру зараз мова (null — пішли зі сторінки). */
export function setAdvisorGame(next) {
  game = next;
  renderBody();
}

/** Відкриває чат і одразу питає «купувати чи чекати» про гру зі сторінки. */
export function askAboutGame() {
  if (!state.user) return go('#/login');
  setOpen(true);
  send('', t('Купувати зараз чи чекати?'));
}
