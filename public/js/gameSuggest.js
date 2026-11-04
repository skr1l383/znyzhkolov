// Підказки ігор під полем пошуку: з'являються під час набору, стрілки ↑↓ гортають, Enter або клік
// відкриває сторінку гри, Esc закриває. Звідки брати ігри, вирішує сторінка: магазин, вітрина чи власний список.
import { go } from './app.js';
import { t } from './i18n.js';
import { formatMoney, formatUah, gameHref, html, setHtml } from './ui.js';

const MAX = 6;

function priceOf(o) {
  if (o.priceUah != null) return formatUah(o.priceUah);
  if (o.price == null) return '';
  return o.price === 0 ? t('Безкоштовно') : formatMoney(o.price, o.currency);
}

/**
 * input — поле з role="combobox", list — порожній <ul role="listbox"> поруч (у батьківському .combo).
 * source(q) → ігри [{ store, storeId, title, imageUrl, discount, priceUah | price + currency }].
 * delay — пауза після набору (для запитів до сервера), skip(q) — коли не підказувати,
 * more(q) — останній рядок-посилання { label, href }, наприклад «Шукати в усіх іграх Steam».
 */
export function mountGameSuggest(input, list, { source, delay = 250, skip = () => false, more = null }) {
  let shown = [];
  let extra = null;
  let active = -1;
  let timer = null;
  let asked = '';
  const count = () => shown.length + (extra ? 1 : 0);
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const mark = (title, q) => {
    const i = title.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? title : html`${title.slice(0, i)}<mark>${title.slice(i, i + q.length)}</mark>${title.slice(i + q.length)}`;
  };
  const show = (q) => {
    if (!count() || document.activeElement !== input) return close();
    active = -1;
    setHtml(
      list,
      html`${shown.map(
        (o, i) => html`<li role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="false">
          ${o.imageUrl ? html`<img src="${o.imageUrl}" alt="" loading="lazy" />` : html`<span class="game-suggest-noimg"></span>`}
          <span class="game-suggest-title">${mark(o.title, q)}</span>
          <span class="game-suggest-price">${o.discount > 0 ? html`<span class="discount">−${o.discount}%</span>` : ''}${priceOf(o)}</span>
        </li>`
      )}
      ${extra
        ? html`<li role="option" class="game-suggest-more" id="${list.id}-${shown.length}" data-i="${shown.length}" aria-selected="false">${extra.label}</li>`
        : ''}`
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const ask = () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2 || skip(q)) {
      asked = q;
      shown = [];
      extra = null;
      return close();
    }
    timer = setTimeout(async () => {
      asked = q;
      try {
        const found = await source(q);
        if (asked !== q) return; // поки чекали, текст змінився
        shown = found.slice(0, MAX);
        extra = more?.(q) || null;
        show(q);
      } catch {
        close(); // без підказок пошук однаково працює
      }
    }, delay);
  };
  const highlight = (i) => {
    active = (i + count()) % count();
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
    input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    list.children[active].scrollIntoView({ block: 'nearest' });
  };
  const choose = (i) => {
    close();
    go(i < shown.length ? gameHref(shown[i].store, shown[i].storeId) : extra.href);
  };

  input.addEventListener('input', ask);
  input.addEventListener('focus', () => input.value.trim() === asked && show(asked));
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // mousedown, а не click: інакше поле встигне втратити фокус і список закриється раніше
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
}
