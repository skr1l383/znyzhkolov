// Головна сторінка: вітрина популярних ігор зі знижками в Steam і GOG з фільтрами.
// Фільтри зберігаються в адресі сторінки (#/?store=gog&minDiscount=50), тож вибірку можна надіслати другові.
import { get } from '../api.js';
import { go, state } from '../app.js';
import { $, $$, STORE_NAMES, cover, formatDate, formatMoney, formatUah, html, setHtml, timeAgo, toast } from '../ui.js';
import { plural } from './watchlist.js';
import { openAddDialog } from './search.js';

const PAGE = 24;
const DEFAULTS = { store: '', minDiscount: '', maxPrice: '', sort: 'popular', q: '' };
const SORTS = [
  ['popular', 'Популярні'],
  ['discount', 'Найбільша знижка'],
  ['cheap', 'Найдешевші'],
  ['rating', 'Найкращі відгуки'],
];
const DISCOUNTS = [25, 50, 75, 90];

function dealCard(d, index) {
  const usd = d.currency === 'USD' ? `${formatMoney(d.price, 'USD')} за курсом НБУ` : '';
  return html`
    <article class="deal-card" data-title="${d.title}">
      <a class="deal-cover" href="${d.url}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
        ${cover(d.imageUrl, d.title, '', d.imageFallback)}
        <span class="deal-badge">−${d.discount}%</span>
      </a>
      <div class="deal-body">
        <div class="deal-meta">
          <span class="store store-${d.store}">${STORE_NAMES[d.store]}</span>
          ${d.rating ? html`<span class="deal-rating" title="Частка схвальних відгуків">${d.rating}% схвальних</span>` : ''}
        </div>
        <h3 class="deal-title">
          <a href="${d.url}" target="_blank" rel="noopener noreferrer" title="Відкрити в ${STORE_NAMES[d.store]}">${d.title}</a>
        </h3>
        <div class="deal-foot">
          <div class="deal-prices" title="${usd}">
            ${d.basePriceUah ? html`<span class="price-old">${formatUah(d.basePriceUah)}</span>` : ''}
            <span class="price">${d.currency === 'USD' ? '≈ ' : ''}${formatUah(d.priceUah)}</span>
          </div>
          ${d.watching
            ? html`<span class="pill pill-good">У списку</span>`
            : html`<button class="btn btn-sm btn-primary" type="button" data-watch="${index}">Стежити</button>`}
        </div>
      </div>
    </article>
  `;
}

function freebiesStrip(freebies) {
  if (!freebies.length) return '';
  return html`
    <section class="home-freebies" aria-label="Безкоштовно в Epic Games">
      <div class="home-freebies-head">
        <h2>Безкоштовно в Epic Games</h2>
        <a href="#/epic" class="hint">Усі роздачі</a>
      </div>
      <div class="home-freebies-row">
        ${freebies.map(
          (f) => html`
            <a class="home-freebie" href="${f.url}" target="_blank" rel="noopener noreferrer" data-title="${f.title}">
              ${cover(f.imageUrl, f.title)}
              <span>
                <strong>${f.title}</strong>
                <span class="hint">Забрати до ${formatDate(f.endsAt)}${f.originalPrice ? html` · <s>${formatUah(f.originalPrice)}</s>` : ''}</span>
              </span>
            </a>`
        )}
      </div>
    </section>
  `;
}

function readFilters(params) {
  const f = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (params[key] != null) f[key] = String(params[key]);
  if (!SORTS.some(([s]) => s === f.sort)) f.sort = 'popular';
  return f;
}

function queryString(filters, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v !== DEFAULTS[k]) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export async function render(root, params) {
  const filters = readFilters(params);
  let items = [];
  let total = 0;
  let pollTimer = null;
  let loadId = 0;

  setHtml(
    root,
    html`
      <div class="page-head">
        <div>
          <h1>Знижки зараз</h1>
          <p class="muted" id="deals-summary">Найпопулярніші ігри зі знижками в Steam і GOG</p>
        </div>
        ${state.user
          ? ''
          : html`<div class="row"><a class="btn" href="#/login">Увійти</a><a class="btn btn-primary" href="#/register">Створити акаунт</a></div>`}
      </div>
      ${state.user
        ? ''
        : html`<p class="intro">
            Знижколов стежить за цінами в Steam і GOG. Натисни «Стежити» на будь-якій грі — і ми повідомимо на сайті
            й у Telegram, щойно вона подешевшає до твоєї ціни.
          </p>`}
      <div id="freebies"></div>

      <form class="filters" role="search" aria-label="Фільтри вітрини">
        <input class="input filter-q" type="search" name="q" placeholder="Пошук за назвою" value="${filters.q}"
          aria-label="Пошук за назвою" maxlength="80" />
        <div class="segmented" role="group" aria-label="Магазин">
          ${[
            ['', 'Усі'],
            ['steam', 'Steam'],
            ['gog', 'GOG'],
          ].map(([v, label]) => html`<button type="button" data-store="${v}" aria-pressed="${String(filters.store === v)}">${label}</button>`)}
        </div>
        <select class="select" name="minDiscount" aria-label="Мінімальна знижка">
          <option value="">Будь-яка знижка</option>
          ${DISCOUNTS.map((d) => html`<option value="${d}" ${filters.minDiscount === String(d) ? 'selected' : ''}>від ${d}%</option>`)}
        </select>
        <div class="input-suffix filter-price">
          <input class="input num" type="number" name="maxPrice" min="0" step="1" inputmode="numeric" placeholder="Ціна до"
            value="${filters.maxPrice}" aria-label="Максимальна ціна, гривень" />
          <span>₴</span>
        </div>
        <select class="select" name="sort" aria-label="Сортування">
          ${SORTS.map(([v, label]) => html`<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${label}</option>`)}
        </select>
        <button class="btn btn-ghost" type="reset" id="filters-reset">Скинути</button>
      </form>

      <div id="deals" aria-live="polite"></div>
      <div class="more-row"><button class="btn" type="button" id="more" hidden>Показати ще</button></div>
    `
  );

  const form = $('.filters', root);
  const box = $('#deals', root);
  const moreBtn = $('#more', root);

  const isDefault = () => Object.entries(filters).every(([k, v]) => v === DEFAULTS[k]);

  function draw() {
    $('#filters-reset', root).hidden = isDefault();
    moreBtn.hidden = items.length >= total;
    if (!items.length) {
      setHtml(
        box,
        html`<div class="empty">
          <h2>Нічого не знайшли</h2>
          <p>За цими фільтрами ігор зі знижкою немає. Спробуй прибрати частину умов.</p>
          <button class="btn" type="button" data-reset>Скинути фільтри</button>
        </div>`
      );
      return;
    }
    setHtml(box, html`<div class="deal-grid">${items.map(dealCard)}</div>`);
  }

  async function load({ append = false } = {}) {
    const id = ++loadId;
    clearTimeout(pollTimer);
    if (!append) setHtml(box, html`<div class="deal-grid">${Array.from({ length: 8 }, () => html`<div class="skeleton deal-skeleton"></div>`)}</div>`);
    let data;
    try {
      data = await get(`/api/deals?${queryString(filters, { limit: PAGE, offset: append ? items.length : 0 })}`);
    } catch (err) {
      if (id === loadId) setHtml(box, html`<div class="empty"><h2>Не вдалося завантажити вітрину</h2><p>${err.message}</p></div>`);
      return;
    }
    if (id !== loadId) return; // поки чекали, фільтри вже змінили

    // Перший запуск сервера: вітрину ще збирають — показуємо заглушку й перевіряємо знову
    if (data.updating && !data.total) {
      setHtml(box, html`<p class="hint">Збираємо знижки з магазинів, це займе кілька секунд…</p>
        <div class="deal-grid">${Array.from({ length: 8 }, () => html`<div class="skeleton deal-skeleton"></div>`)}</div>`);
      pollTimer = setTimeout(() => load(), 3000);
      return;
    }

    items = append ? [...items, ...data.items] : data.items;
    total = data.total;
    const all = Object.values(data.counts).reduce((a, b) => a + b, 0);
    $('#deals-summary', root).textContent = isDefault()
      ? `${all} ${plural(all, 'гра', 'гри', 'ігор')} зі знижкою в Steam і GOG${data.updatedAt ? ` · оновлено ${timeAgo(data.updatedAt)}` : ''}`
      : `Знайдено ${total} з ${all}${data.updatedAt ? ` · оновлено ${timeAgo(data.updatedAt)}` : ''}`;
    if (!append) setHtml($('#freebies', root), freebiesStrip(data.freebies));
    draw();
  }

  // Фільтри → адреса сторінки → новий запит. replaceState не створює зайвих кроків в історії «Назад».
  function apply() {
    const qs = queryString(filters);
    history.replaceState(null, '', `#/${qs ? `?${qs}` : ''}`);
    load();
  }

  let typing = null;
  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (!name) return;
    filters[name] = e.target.value.trim();
    clearTimeout(typing);
    // Текст і ціну чекаємо, поки людина допише; списки застосовуємо одразу
    typing = setTimeout(apply, e.target.tagName === 'SELECT' ? 0 : 350);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-store]');
    if (!btn) return;
    filters.store = btn.dataset.store;
    $$('[data-store]', form).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    apply();
  });
  const reset = () => {
    Object.assign(filters, DEFAULTS);
    form.reset();
    form.elements.q.value = '';
    form.elements.maxPrice.value = '';
    form.elements.minDiscount.value = '';
    form.elements.sort.value = 'popular';
    $$('[data-store]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.store === '')));
    apply();
  };
  form.addEventListener('reset', (e) => {
    e.preventDefault();
    reset();
  });

  moreBtn.addEventListener('click', () => load({ append: true }));

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset]')) return reset();
    const btn = e.target.closest('[data-watch]');
    if (!btn) return;
    const deal = items[Number(btn.dataset.watch)];
    if (!state.user) {
      toast('Створи акаунт або увійди, щоб стежити за цінами');
      return go('#/register');
    }
    openAddDialog(deal, {
      onAdded: () => {
        deal.watching = true;
        draw();
      },
    });
  });

  await load();
  return () => clearTimeout(pollTimer);
}
