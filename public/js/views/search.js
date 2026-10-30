// Пошук ігор у Steam і GOG та додавання до списку.
import { get, post } from '../api.js';
import { t } from '../i18n.js';
import { go, state } from '../app.js';
import {
  $,
  STORE_NAMES,
  closeDialog,
  cover,
  formatMoney,
  formatUah,
  gameHref,
  html,
  openDialog,
  setHtml,
  showFormError,
  toast,
  withLoading,
} from '../ui.js';
import { conditionsFields, readConditions } from './conditions.js';
import { dealCard } from './showcase.js';
import { steamImportDialog } from './steamImport.js';

const STORES = ['steam', 'gog'];
const SUGGESTIONS = ['Hades', 'Stardew Valley', 'Hollow Knight', 'Cyberpunk 2077', 'The Witcher 3', 'Terraria'];

const approxUah = (o) => (o.currency === 'USD' && o.price != null ? Math.round(o.price * state.app.usdRate) : null);

function priceBlock(o) {
  if (o.price == null) return html`<span class="muted">${t('Ціни немає')}</span>`;
  const approx = approxUah(o);
  return html`
    <span class="price-values">
      ${o.discount > 0 ? html`<span class="discount">−${o.discount}%</span>` : ''}
      <span class="price">${formatMoney(o.price, o.currency)}</span>
      ${approx != null ? html`<span class="muted num">≈ ${formatUah(approx)}</span>` : ''}
    </span>
  `;
}

function resultCard(o, index, linkMode) {
  let button;
  if (o.watching) button = html`<span class="pill pill-good">${t('У списку')}</span>`;
  else if (linkMode) button = html`<button class="btn btn-sm btn-primary" type="button" data-index="${index}">${t('Додати до гри')}</button>`;
  else button = html`<button class="btn btn-sm btn-primary" type="button" data-index="${index}">${t('Стежити')}</button>`;
  return html`
    <article class="result-card">
      ${cover(o.imageUrl, o.title)}
      <div>
        <span class="store store-${o.store}">${STORE_NAMES[o.store]}</span>
        <h3><a class="plain-link" href="${gameHref(o.store, o.storeId)}">${o.title}</a></h3>
      </div>
      <div class="result-foot">${priceBlock(o)} ${button}</div>
    </article>
  `;
}

/** Діалог «Стежити за ціною». Використовується на сторінці пошуку і на вітрині. */
export async function openAddDialog(offer, { onAdded } = {}) {
  const dialog = openDialog(html`
    <form class="dialog-body" novalidate>
      <div class="dialog-head">
        ${cover(offer.imageUrl, offer.title)}
        <div>
          <span class="store store-${offer.store}">${STORE_NAMES[offer.store]}</span>
          <h2>${offer.title}</h2>
          <div>${priceBlock(offer)}</div>
        </div>
      </div>
      <div class="form-error" role="alert" hidden></div>
      <div class="stack">
        <span class="label">${t('Ця гра в інших магазинах')}</span>
        <div class="match-list" id="matches"><div class="hint">${t('Шукаємо збіги…')}</div></div>
      </div>
      <div class="stack">
        <span class="label">${t('Коли повідомити')}</span>
        ${conditionsFields({ minDiscount: 30, notifyFree: true })}
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>${t('Скасувати')}</button>
        <button class="btn btn-primary" type="submit">${t('Стежити за ціною')}</button>
      </div>
    </form>
  `);

  const form = $('form', dialog);
  $('[data-close]', form).addEventListener('click', closeDialog);

  let matches = [];
  get(`/api/match?store=${offer.store}&title=${encodeURIComponent(offer.title)}`)
    .then((res) => {
      matches = res.matches;
      const box = $('#matches', form);
      if (!box) return;
      if (!matches.length) {
        setHtml(
          box,
          html`<div class="hint">${res.errors.length ? res.errors.map((e) => t(e)).join('; ') : t('В інших магазинах цієї гри не знайшли.')} ${t('Магазин можна додати пізніше зі списку.')}</div>`
        );
        return;
      }
      const preselected = new Set();
      setHtml(
        box,
        html`${matches.map((m, i) => {
          const check = m.score >= 0.9 && !preselected.has(m.store);
          if (check) preselected.add(m.store);
          return html`
            <label class="match">
              <input type="checkbox" name="match" value="${i}" ${check ? 'checked' : ''} />
              <span>
                <span class="store store-${m.store}">${STORE_NAMES[m.store]}</span>
                <span class="match-title">${m.title}</span>
              </span>
              ${priceBlock(m)}
            </label>`;
        })}
        <div class="hint">${t('Познач, якщо це та сама гра. Тоді ми порівнюватимемо ціни в обох магазинах.')}</div>`
      );
    })
    .catch(() => {
      const box = $('#matches', form);
      if (box) setHtml(box, html`<div class="hint">${t('Не вдалося перевірити інші магазини. Можна додати їх пізніше.')}</div>`);
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chosen = [...form.querySelectorAll('input[name="match"]:checked')].map((c) => matches[Number(c.value)]);
    const stores = new Set([offer.store]);
    const extra = chosen.filter((m) => !stores.has(m.store) && stores.add(m.store));
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        await post('/api/watch', { offer, extra, ...readConditions(form) });
        closeDialog();
        toast(t('«{title}» додано. Повідомимо, щойно умова виконається', { title: offer.title }));
        if (onAdded) onAdded();
        else go('#/list');
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

/**
 * Поки нічого не шукаємо: як працює стеження, імпорт зі Steam і популярні знижки,
 * за якими можна почати стежити одним натиском.
 */
async function discover(box) {
  const steps = [
    ['🔍', t('Знайди гру'), t('У Steam або GOG — ту саму гру в іншому магазині підберемо самі.')],
    ['🎯', t('Вкажи умову'), t('Знижка від якогось відсотка або ціна, нижче якої ти готовий купити.')],
    ['🔔', t('Отримай сповіщення'), t('Щойно ціна підійде — напишемо на сайті, у Telegram і на пошту.')],
  ];
  setHtml(
    box,
    html`
      <ol class="how-steps">
        ${steps.map(([icon, title, text]) => html`<li><span class="how-icon" aria-hidden="true">${icon}</span><b>${title}</b><span>${text}</span></li>`)}
      </ol>
      <section class="import-card">
        <div>
          <h2>${t('Маєш список бажаного в Steam?')}</h2>
          <p>${t('Встав посилання на профіль — і стеж за всіма іграми зі списку за хвилину.')}</p>
        </div>
        <button class="btn btn-primary" type="button" id="search-steam-import">${t('Імпортувати зі Steam')}</button>
      </section>
      <section class="starter">
        <h2>${t('Популярні знижки зараз')}</h2>
        <div class="deal-grid" id="search-deals">${Array.from({ length: 6 }, () => html`<div class="skeleton deal-skeleton"></div>`)}</div>
      </section>
    `
  );
  $('#search-steam-import', box).addEventListener('click', () => steamImportDialog(() => go('#/list')));

  const grid = $('#search-deals', box);
  let deals = [];
  try {
    deals = (await get('/api/deals/featured')).items;
    if (!grid.isConnected) return;
    if (!deals.length) throw new Error('empty');
    setHtml(grid, html`${deals.map(dealCard)}`);
  } catch {
    grid.closest('.starter')?.remove(); // вітрина ще не завантажилась — без добірки
    return;
  }
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-watch]');
    if (!btn) return;
    openAddDialog(deals[Number(btn.dataset.watch)], {
      onAdded: () => {
        btn.replaceWith(Object.assign(document.createElement('span'), { className: 'pill pill-good', textContent: t('У списку') }));
      },
    });
  });
}

export async function render(root, params) {
  const storeName = STORES.includes(params.store) ? params.store : 'steam';
  const q = (params.q || '').trim();
  const linkId = params.link ? Number(params.link) : null;
  const hashFor = (query, store) => {
    const p = new URLSearchParams({ q: query, store });
    if (linkId) p.set('link', String(linkId));
    return `#/search?${p}`;
  };

  setHtml(
    root,
    html`
      <section class="search-hero ${q ? 'is-compact' : ''}">
        <div class="search-hero-head">
          <span class="search-hero-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
          <div>
            <h1>${linkId ? t('Додати магазин до гри') : t('Знайти гру')}</h1>
            <p>${linkId
              ? t('Знайди цю гру в іншому магазині, щоб порівнювати ціни.')
              : t('Шукай у Steam або GOG. Ту саму гру в іншому магазині ми спробуємо знайти автоматично.')}</p>
          </div>
        </div>
        <form class="search-bar" role="search">
          <div class="segmented" role="group" aria-label="${t('Магазин')}">
            ${STORES.map(
              (s) => html`<button type="button" data-store="${s}" aria-pressed="${s === storeName}">${STORE_NAMES[s]}</button>`
            )}
          </div>
          <label class="visually-hidden" for="search-q">${t('Назва гри')}</label>
          <input class="input" id="search-q" name="q" type="search" placeholder="${t('Назва гри, наприклад Hades')}" value="${q}"
            minlength="2" maxlength="80" autocomplete="off" />
          <button class="btn btn-primary" type="submit">${t('Шукати')}</button>
        </form>
        ${q || linkId
          ? ''
          : html`<div class="suggestions">
              <span class="hint">${t('Популярне:')}</span>
              ${SUGGESTIONS.map((s) => html`<a class="chip suggestion" href="${hashFor(s, storeName)}">${s}</a>`)}
            </div>`}
      </section>
      <div id="results"></div>
    `
  );

  const form = $('.search-bar', root);
  const input = $('#search-q', root);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (value.length < 2) {
      toast(t('Введіть щонайменше 2 символи'), 'error');
      input.focus();
      return;
    }
    go(hashFor(value, storeName));
  });

  root.querySelectorAll('[data-store]').forEach((b) =>
    b.addEventListener('click', () => go(hashFor(input.value.trim() || q, b.dataset.store)))
  );

  const box = $('#results', root);
  if (!q) {
    if (!linkId) discover(box);
    input.focus();
    return;
  }

  setHtml(box, html`<div class="results">${[1, 2, 3, 4].map(() => html`<div class="skeleton"></div>`)}</div>`);
  let results;
  try {
    results = (await get(`/api/search?store=${storeName}&q=${encodeURIComponent(q)}`)).results;
  } catch (err) {
    setHtml(box, html`<div class="empty"><h2>${t('Пошук не вдався')}</h2><p>${err.message}</p></div>`);
    return;
  }

  if (!results.length) {
    const other = STORES.find((s) => s !== storeName);
    setHtml(
      box,
      html`<div class="empty">
        <h2>${t('Нічого не знайшли в {store}', { store: STORE_NAMES[storeName] })}</h2>
        <p>${t('Перевір назву або спробуй пошукати англійською. Можливо, гра є в іншому магазині.')}</p>
        <a class="btn" href="${hashFor(q, other)}">${t('Шукати в {store}', { store: STORE_NAMES[other] })}</a>
      </div>`
    );
    return;
  }

  setHtml(box, html`<div class="results">${results.map((r, i) => resultCard(r, i, Boolean(linkId)))}</div>`);
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-index]');
    if (!btn) return;
    const offer = results[Number(btn.dataset.index)];
    if (!linkId) return openAddDialog(offer);
    await withLoading(btn, async () => {
      try {
        await post(`/api/watch/${linkId}/offers`, { offer });
        toast(t('{store} додано до гри', { store: STORE_NAMES[offer.store] }));
        go('#/list');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
