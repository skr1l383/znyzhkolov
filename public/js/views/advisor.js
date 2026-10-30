// Блок «ШІ-порадник» на сторінці гри: вердикт «купувати зараз чи чекати» і коротка розмова з уточненнями.
// Відповідь моделі — звичайний текст: показуємо його лише через екранування (html``), тож ні посилання,
// ні скрипти з відповіді на сторінку не потраплять.
import { post } from '../api.js';
import { getLang, locale, t, tp } from '../i18n.js';
import { go, state } from '../app.js';
import { $, html, toast } from '../ui.js';

const TOOL_NAMES = {
  get_game_prices: 'ціни',
  get_price_history: 'історія цін',
  get_steam_key_offers: 'ключі Steam',
  search_deals: 'вітрина знижок',
  get_my_watchlist: 'мій список',
};

export function advisorSection() {
  if (!state.app?.ai) return '';
  return html`
    <section class="advisor" id="advisor" aria-labelledby="advisor-title">
      <div class="advisor-head">
        <span class="advisor-badge" aria-hidden="true">AI</span>
        <div>
          <h2 id="advisor-title">${t('ШІ-порадник')}</h2>
          <p class="hint">${t('Подивиться ціни, історію знижок і ключі та підкаже, чи варто чекати.')}</p>
        </div>
      </div>
      <div class="advisor-log" id="advisor-log" aria-live="polite"></div>
      <button class="btn btn-primary btn-block" type="button" id="advisor-ask">${t('Купувати зараз чи чекати?')}</button>
      <form class="advisor-form" id="advisor-form" hidden>
        <input name="q" maxlength="500" autocomplete="off" placeholder="${t('Запитай ще щось про ціну…')}" aria-label="${t('Питання порадникові')}" required />
        <button class="btn btn-sm" type="submit">${t('Надіслати')}</button>
      </form>
    </section>
  `;
}

/** **жирний** усередині рядка → <b>, решта як текст. */
const inline = (line) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? html`<b>${part}</b>` : part));

/** Відповідь моделі: абзаци й пункти списку («•», «-», «*» на початку рядка). */
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

export function mountAdvisor(root, offer) {
  const box = $('#advisor', root);
  if (!box) return;
  const log = $('#advisor-log', box);
  const askBtn = $('#advisor-ask', box);
  const form = $('#advisor-form', box);
  const history = []; // репліки розмови для уточнень: { role: 'user' | 'model', text }
  let busy = false;

  const add = (node) => {
    log.insertAdjacentHTML('beforeend', String(node));
    log.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  async function ask(question) {
    if (busy) return;
    if (!state.user) {
      toast(t('Увійди в акаунт, щоб спитати ШІ-порадника'));
      return go('#/login');
    }
    busy = true;
    askBtn.disabled = true;
    form.querySelector('button').disabled = true;
    if (question) add(html`<div class="advisor-msg is-user">${question}</div>`);
    add(html`<div class="advisor-msg is-thinking"><span class="advisor-dots" aria-hidden="true"></span>${t('Перевіряю ціни й історію знижок…')}</div>`);
    try {
      const r = await post('/api/advisor', { store: offer.store, id: offer.storeId, question, history: history.slice(-6), lang: getLang() });
      log.lastElementChild.remove();
      add(html`<div class="advisor-msg is-ai">${answerHtml(r.answer)}${metaLine(r)}</div>`);
      history.push({ role: 'user', text: question || t('Купувати цю гру зараз чи чекати знижки?') }, { role: 'model', text: r.answer });
      askBtn.hidden = true;
      form.hidden = false;
    } catch (err) {
      log.lastElementChild.remove();
      // ШІ недоступний (ліміт, перевантаження) — пояснюємо, а решта сторінки працює як була
      add(html`<div class="advisor-msg is-error" role="alert">${err.message}</div>`);
      if (question) form.elements.q.value = question;
    } finally {
      busy = false;
      askBtn.disabled = false;
      form.querySelector('button').disabled = false;
    }
  }

  askBtn.addEventListener('click', () => ask(''));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = form.elements.q.value.trim();
    if (!q) return;
    form.elements.q.value = '';
    ask(q);
  });
}
