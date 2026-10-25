// Головна сторінка: вітрина популярних ігор зі знижками в Steam і GOG з фільтрами.
// Фільтри зберігаються в адресі сторінки (#/?store=gog&minDiscount=50), тож вибірку можна надіслати другові.
import { get } from '../api.js';
import { setBackdrop } from '../backdrop.js';
import { go, state } from '../app.js';
import { $, $$, STORE_NAMES, cover, gameHref, formatDate, formatMoney, formatUah, html, setHtml, timeAgo, toast } from '../ui.js';
import { t, tp } from '../i18n.js';
import { openAddDialog } from './search.js';

const PAGE = 24;
const DEFAULTS = { store: '', minDiscount: '', maxPrice: '', genre: '', company: '', sort: 'popular', q: '', page: '1' };
// Ключі збігаються з серверними (server/stores/genres.js)
const GENRES = [
  ['action', 'Бойовик'],
  ['adventure', 'Пригоди'],
  ['rpg', 'Рольова гра'],
  ['strategy', 'Стратегія'],
  ['simulation', 'Симулятор'],
  ['shooter', 'Шутер'],
  ['horror', 'Жахи'],
  ['platformer', 'Платформер'],
  ['puzzle', 'Головоломка'],
  ['survival', 'Виживання'],
  ['openworld', 'Відкритий світ'],
  ['racing', 'Перегони'],
  ['sports', 'Спорт'],
  ['indie', 'Інді'],
];
const SLIDE_MS = 6000;
const SORTS = [
  ['popular', 'Популярні'],
  ['discount', 'Найбільша знижка'],
  ['cheap', 'Найдешевші'],
  ['rating', 'Найкращі відгуки'],
];
const DISCOUNTS = [25, 50, 75, 90];

function dealCard(d, index) {
  const usd = d.currency === 'USD' ? t('{price} за курсом НБУ', { price: formatMoney(d.price, 'USD') }) : '';
  return html`
    <article class="deal-card" data-title="${d.title}">
      <a class="deal-cover" href="${gameHref(d.store, d.storeId)}" tabindex="-1" aria-hidden="true">
        ${cover(d.imageUrl, d.title, '', d.imageFallback)}
        <span class="deal-badge">−${d.discount}%</span>
      </a>
      <div class="deal-body">
        <div class="deal-meta">
          <span class="store store-${d.store}">${STORE_NAMES[d.store]}</span>
          ${d.rating ? html`<span class="deal-rating" title="${t('Частка схвальних відгуків')}">${t('{n}% схвальних', { n: d.rating })}</span>` : ''}
        </div>
        <h3 class="deal-title">
          <a href="${gameHref(d.store, d.storeId)}">${d.title}</a>
        </h3>
        <div class="deal-foot">
          <div class="deal-prices" title="${usd}">
            ${d.basePriceUah ? html`<span class="price-old">${formatUah(d.basePriceUah)}</span>` : ''}
            <span class="price">${d.currency === 'USD' ? '≈ ' : ''}${formatUah(d.priceUah)}</span>
          </div>
          ${d.watching
            ? html`<span class="pill pill-good">${t('У списку')}</span>`
            : html`<button class="btn btn-sm btn-primary" type="button" data-watch="${index}">${t('Стежити')}</button>`}
        </div>
      </div>
    </article>
  `;
}

function freebiesStrip(freebies) {
  if (!freebies.length) return '';
  return html`
    <section class="home-freebies" aria-label="${t('Безкоштовно в Epic Games')}">
      <div class="home-freebies-head">
        <h2>${t('Безкоштовно в Epic Games')}</h2>
        <a href="#/epic" class="hint">${t('Усі роздачі')}</a>
      </div>
      <div class="home-freebies-row">
        ${freebies.map(
          (f) => html`
            <a class="home-freebie" href="${f.url}" target="_blank" rel="noopener noreferrer" data-title="${f.title}">
              ${cover(f.imageUrl, f.title)}
              <span>
                <strong>${f.title}</strong>
                <span class="hint">${t('Забрати до {date}', { date: formatDate(f.endsAt) })}${f.originalPrice ? html` · <s>${formatUah(f.originalPrice)}</s>` : ''}</span>
              </span>
            </a>`
        )}
      </div>
    </section>
  `;
}

// ---------- Банер-карусель з найкращими пропозиціями ----------

function heroSlide(d, i, count) {
  const usd = d.currency === 'USD' ? '≈ ' : '';
  // Картинку першого слайда вантажимо одразу, решту — коли до них дійде черга (data-src), щоб не тягнути зайві мегабайти
  return html`
    <article class="hero-slide ${i === 0 ? 'active' : ''}" aria-roledescription="${t('слайд')}" aria-label="${t('{n} з {count}', { n: i + 1, count })}: ${d.title}"
      aria-hidden="${String(i !== 0)}" data-title="${d.title}">
      <img class="cover hero-img" ${i === 0 ? html`src="${d.heroImage}"` : html`data-src="${d.heroImage}"`}
        data-fallback="${d.heroFallback || ''}" alt="" referrerpolicy="no-referrer" />
      <div class="hero-shade"></div>
      <div class="hero-content">
        <div class="hero-kicker">
          <span class="store store-${d.store}">${STORE_NAMES[d.store]}</span>
          ${d.rating ? html`<span>${t('{n}% схвальних відгуків', { n: d.rating })}</span>` : ''}
        </div>
        <h2 class="hero-title">${d.title}</h2>
        <div class="hero-price">
          <span class="hero-discount">−${d.discount}%</span>
          ${d.basePriceUah ? html`<s>${formatUah(d.basePriceUah)}</s>` : ''}
          <strong>${usd}${formatUah(d.priceUah)}</strong>
        </div>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${gameHref(d.store, d.storeId)}" tabindex="${i === 0 ? '0' : '-1'}">${t('Детальніше')}</a>
          ${d.watching
            ? html`<span class="pill pill-good">${t('У списку')}</span>`
            : html`<button class="btn hero-watch" type="button" data-hero-watch="${i}" tabindex="${i === 0 ? '0' : '-1'}">${t('Стежити')}</button>`}
        </div>
      </div>
    </article>`;
}

function heroCarousel(items) {
  return html`
    <section class="hero" aria-roledescription="${t('карусель')}" aria-label="${t('Найкращі пропозиції зараз')}">
      <div class="hero-track">${items.map((d, i) => heroSlide(d, i, items.length))}</div>
      <button class="hero-arrow prev" type="button" data-hero-step="-1" aria-label="${t('Попередня пропозиція')}">‹</button>
      <button class="hero-arrow next" type="button" data-hero-step="1" aria-label="${t('Наступна пропозиція')}">›</button>
      <div class="hero-dots">
        ${items.map(
          (d, i) => html`<button type="button" class="${i === 0 ? 'active' : ''}" data-hero-go="${i}" aria-label="${t('Пропозиція {n}', { n: i + 1 })}: ${d.title}"></button>`
        )}
      </div>
    </section>`;
}

/** Оживляє карусель: автоперемикання, стрілки, крапки, свайп. Повертає функцію зупинки. */
function mountHero(box, items, onWatch) {
  setHtml(box, items.length ? heroCarousel(items) : '');
  if (!items.length) return () => {};
  const section = $('.hero', box);
  const slides = $$('.hero-slide', section);
  const dots = $$('[data-hero-go]', section);
  let current = 0;
  let timer = null;


  const loadImage = (n) => {
    const img = $('img[data-src]', slides[n]);
    if (img) {
      img.src = img.dataset.src;
      delete img.dataset.src;
    }
  };
  const show = (n) => {
    current = (n + slides.length) % slides.length;
    loadImage(current);
    loadImage((current + 1) % slides.length); // наступну підвантажуємо заздалегідь
    slides.forEach((s, k) => {
      const on = k === current;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', String(!on));
      s.querySelectorAll('a, button').forEach((el) => (el.tabIndex = on ? 0 : -1));
    });
    dots.forEach((d, k) => d.classList.toggle('active', k === current));
    setBackdrop(items[current].heroImage);
  };
  // Хто просить менше руху на екрані — без автоперемикання
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const play = () => {
    clearInterval(timer);
    if (!still && slides.length > 1) timer = setInterval(() => show(current + 1), SLIDE_MS);
  };
  const pause = () => clearInterval(timer);

  section.addEventListener('click', (e) => {
    const step = e.target.closest('[data-hero-step]');
    const dot = e.target.closest('[data-hero-go]');
    const watch = e.target.closest('[data-hero-watch]');
    if (step) show(current + Number(step.dataset.heroStep));
    else if (dot) show(Number(dot.dataset.heroGo));
    else if (watch) onWatch(items[Number(watch.dataset.heroWatch)], watch);
    if (step || dot) play();
  });
  section.addEventListener('mouseenter', pause);
  section.addEventListener('mouseleave', play);
  section.addEventListener('focusin', pause);
  section.addEventListener('focusout', play);

  // Свайп пальцем на телефоні
  let startX = null;
  section.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') startX = e.clientX;
  });
  section.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      show(current + (dx < 0 ? 1 : -1));
      play();
    }
  });

  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);
  loadImage(1);
  setBackdrop(items[0].heroImage);
  play();
  return () => {
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// ---------- Сторінки ----------

/** Номери сторінок для навігації: 1 2 3 4 5 … 17, 1 … 6 7 8 9 10 … 17, 1 … 13 14 15 16 17. */
function pageNumbers(page, pages) {
  // Поточна сторінка посередині вікна з п'яти номерів; біля країв вікно впирається в край
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const windowPages = Array.from({ length: 5 }, (_, i) => start + i);
  const wanted = [1, pages, ...windowPages].filter((n) => n >= 1 && n <= pages);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev && n - prev === 2) out.push(prev + 1); // пропуск в одну сторінку — краще показати її номер
    else if (prev && n - prev > 2) out.push('…');
    out.push(n);
  });
  return out;
}

function pager(page, pages) {
  if (pages <= 1) return '';
  return html`
    <nav class="pager" aria-label="${t('Сторінки вітрини')}">
      <button class="pager-btn" type="button" data-page="${page - 1}" aria-label="${t('Попередня сторінка')}" ${page === 1 ? html`disabled` : ''}>‹</button>
      ${pageNumbers(page, pages).map((n) =>
        n === '…'
          ? html`<span class="pager-gap" aria-hidden="true">…</span>`
          : html`<button class="pager-btn ${n === page ? 'active' : ''}" type="button" data-page="${n}"
              aria-label="${t('Сторінка {n}', { n })}" ${n === page ? html`aria-current="page"` : ''}>${n}</button>`
      )}
      <button class="pager-btn" type="button" data-page="${page + 1}" aria-label="${t('Наступна сторінка')}" ${page === pages ? html`disabled` : ''}>›</button>
    </nav>`;
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
      <div id="hero"></div>
      <div class="page-head">
        <div>
          <h1>${t('Знижки зараз')}</h1>
          <p class="muted" id="deals-summary">${t('Найпопулярніші ігри зі знижками в Steam і GOG')}</p>
        </div>
        ${state.user
          ? ''
          : html`<div class="row"><a class="btn" href="#/login">${t('Увійти')}</a><a class="btn btn-primary" href="#/register">${t('Створити акаунт')}</a></div>`}
      </div>
      ${state.user
        ? ''
        : html`<p class="intro">
            ${t('Знижколов стежить за цінами в Steam і GOG. Натисни «Стежити» на будь-якій грі — і ми повідомимо на сайті й у Telegram, щойно вона подешевшає до твоєї ціни.')}
          </p>`}
      <div id="freebies"></div>

      <form class="filters" role="search" aria-label="${t('Фільтри вітрини')}">
        <div class="filters-top">
          <div class="filter-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input class="input" type="search" name="q" placeholder="${t('Пошук за назвою')}" value="${filters.q}"
              aria-label="${t('Пошук за назвою')}" maxlength="80" />
          </div>
          <select class="select filter-sort" name="sort" aria-label="${t('Сортування')}">
            ${SORTS.map(([v, label]) => html`<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${t(label)}</option>`)}
          </select>
        </div>
        <div class="filters-row">
          <div class="filter-group">
            <span class="filter-label" aria-hidden="true">${t('Магазин')}</span>
            <div class="segmented" role="group" aria-label="${t('Магазин')}">
              ${[
                ['', 'Усі'],
                ['steam', 'Steam'],
                ['gog', 'GOG'],
              ].map(
                ([v, label]) =>
                  html`<button type="button" data-filter="store" data-value="${v}" aria-pressed="${String(filters.store === v)}">${v ? html`<i class="store-dot ${v}"></i>` : ''}${t(label)}</button>`
              )}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label" aria-hidden="true">${t('Знижка')}</span>
            <div class="segmented chips" role="group" aria-label="${t('Мінімальна знижка')}">
              ${['', ...DISCOUNTS.map(String)].map(
                (v) =>
                  html`<button type="button" data-filter="minDiscount" data-value="${v}" aria-pressed="${String(filters.minDiscount === v)}">${v ? `${v}%+` : t('Будь-яка')}</button>`
              )}
            </div>
          </div>
          <div class="filter-group">
            <span class="filter-label" aria-hidden="true">${t('Жанр')}</span>
            <select class="select filter-genre" name="genre" aria-label="${t('Жанр')}">
              <option value="">${t('Будь-який жанр')}</option>
              ${GENRES.map(([v, label]) => html`<option value="${v}" ${filters.genre === v ? 'selected' : ''}>${t(label)}</option>`)}
            </select>
          </div>
          <div class="filter-group">
            <span class="filter-label" aria-hidden="true">${t('Студія')}</span>
            <input class="input filter-company" type="search" name="company" list="companies" maxlength="80" autocomplete="off"
              placeholder="${t('Розробник або видавець')}" value="${filters.company}" aria-label="${t('Розробник або видавець')}" />
            <datalist id="companies"></datalist>
          </div>
          <div class="filter-group">
            <span class="filter-label" aria-hidden="true">${t('Ціна до')}</span>
            <div class="input-suffix filter-price">
              <input class="input num" type="number" name="maxPrice" min="0" step="1" inputmode="numeric" placeholder="${t('Будь-яка')}"
                value="${filters.maxPrice}" aria-label="${t('Максимальна ціна, гривень')}" />
              <span>₴</span>
            </div>
          </div>
          <button class="btn btn-ghost filters-reset" type="reset" id="filters-reset">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>${t('Скинути')}
          </button>
        </div>
      </form>

      <div id="deals" aria-live="polite"></div>
      <div id="pager"></div>
    `
  );

  const form = $('.filters', root);
  const box = $('#deals', root);
  const pagerBox = $('#pager', root);
  const page = () => Math.max(1, Number(filters.page) || 1);

  // Номер сторінки — не фільтр: «Скинути» і підсумок на нього не зважають
  const isDefault = () => Object.entries(filters).every(([k, v]) => k === 'page' || v === DEFAULTS[k]);

  function draw() {
    $('#filters-reset', root).hidden = isDefault();
    setHtml(pagerBox, pager(page(), Math.ceil(total / PAGE)));
    if (!items.length) {
      setHtml(
        box,
        html`<div class="empty">
          <h2>${t('Нічого не знайшли')}</h2>
          <p>${t('За цими фільтрами ігор зі знижкою немає. Спробуй прибрати частину умов.')}</p>
          <button class="btn" type="button" data-reset>${t('Скинути фільтри')}</button>
        </div>`
      );
      return;
    }
    setHtml(box, html`<div class="deal-grid">${items.map(dealCard)}</div>`);
  }

  async function load() {
    const id = ++loadId;
    clearTimeout(pollTimer);
    setHtml(box, html`<div class="deal-grid">${Array.from({ length: 8 }, () => html`<div class="skeleton deal-skeleton"></div>`)}</div>`);
    let data;
    try {
      data = await get(`/api/deals?${queryString({ ...filters, page: DEFAULTS.page }, { limit: PAGE, offset: (page() - 1) * PAGE })}`);
    } catch (err) {
      if (id === loadId) setHtml(box, html`<div class="empty"><h2>${t('Не вдалося завантажити вітрину')}</h2><p>${err.message}</p></div>`);
      return;
    }
    if (id !== loadId) return; // поки чекали, фільтри вже змінили

    // Перший запуск сервера: вітрину ще збирають — показуємо заглушку й перевіряємо знову
    if (data.updating && !data.total) {
      setHtml(box, html`<p class="hint">${t('Збираємо знижки з магазинів, це займе кілька секунд…')}</p>
        <div class="deal-grid">${Array.from({ length: 8 }, () => html`<div class="skeleton deal-skeleton"></div>`)}</div>`);
      pollTimer = setTimeout(() => load(), 3000);
      return;
    }

    items = data.items;
    total = data.total;
    // Сторінки з таким номером уже немає (наприклад, змінились фільтри) — на останню наявну
    if (!items.length && total && page() > 1) {
      filters.page = String(Math.ceil(total / PAGE));
      return apply({ keepPage: true });
    }
    const all = Object.values(data.counts).reduce((a, b) => a + b, 0);
    const pages = Math.ceil(total / PAGE);
    $('#deals-summary', root).textContent = [
      isDefault() ? t('{n} {games} зі знижкою в Steam і GOG', { n: all, games: tp(all, 'гра', 'гри', 'ігор') }) : t('Знайдено {n} з {all}', { n: total, all }),
      pages > 1 ? t('сторінка {n} з {pages}', { n: page(), pages }) : '',
      data.updatedAt ? t('оновлено {when}', { when: timeAgo(data.updatedAt) }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    setHtml($('#freebies', root), freebiesStrip(data.freebies));
    draw();
    if (!heroShown) loadHero();
  }

  // Фільтри → адреса сторінки → новий запит. replaceState не створює зайвих кроків в історії «Назад».
  function apply({ keepPage = false } = {}) {
    if (!keepPage) filters.page = DEFAULTS.page; // нові фільтри — з першої сторінки
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
    // Кнопки-перемикачі: магазин і мінімальна знижка
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const key = btn.dataset.filter;
    filters[key] = btn.dataset.value;
    $$(`[data-filter="${key}"]`, form).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    apply();
  });
  const reset = () => {
    Object.assign(filters, DEFAULTS);
    form.reset();
    form.elements.q.value = '';
    form.elements.maxPrice.value = '';
    form.elements.genre.value = '';
    form.elements.company.value = '';
    form.elements.sort.value = 'popular';
    $$('[data-filter]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === '')));
    apply();
  };
  form.addEventListener('reset', (e) => {
    e.preventDefault();
    reset();
  });

  pagerBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    filters.page = btn.dataset.page;
    // До початку вітрини, щоб нова сторінка читалась зверху. Миттєво й до завантаження:
    // плавну прокрутку перебило б перемальовування сітки
    window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 80, behavior: 'instant' });
    apply({ keepPage: true });
  });

  const watch = (deal, onAdded) => {
    if (!state.user) {
      toast(t('Створи акаунт або увійди, щоб стежити за цінами'));
      return go('#/register');
    }
    openAddDialog(deal, {
      onAdded: () => {
        deal.watching = true;
        onAdded();
      },
    });
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset]')) return reset();
    const btn = e.target.closest('[data-watch]');
    if (btn) watch(items[Number(btn.dataset.watch)], draw);
  });

  // Які жанри й студії зараз є на вітрині: кількість ігор біля жанру і підказки для студії
  get('/api/deals/facets')
    .then(({ genres, companies }) => {
      if (!root.isConnected) return;
      const counts = new Map(genres.map((g) => [g.key, g.count]));
      for (const option of form.elements.genre.options) {
        if (!option.value) continue;
        const n = counts.get(option.value) || 0;
        option.textContent = `${t(GENRES.find(([k]) => k === option.value)[1])} (${n})`;
        option.disabled = !n && option.value !== filters.genre;
      }
      setHtml($('#companies', root), html`${companies.map((c) => html`<option value="${c.name}"></option>`)}`);
    })
    .catch(() => {}); // без підказок фільтри однаково працюють

  // Банер вантажимо окремо: він не залежить від фільтрів і не перемальовується при їх зміні
  let heroShown = false;
  let stopHero = () => {};
  async function loadHero() {
    try {
      const { items: featured } = await get('/api/deals/featured');
      if (!featured.length || !root.isConnected) return;
      heroShown = true;
      stopHero();
      stopHero = mountHero($('#hero', root), featured, (d, button) =>
        watch(d, () => {
          const pill = document.createElement('span');
          pill.className = 'pill pill-good';
          pill.textContent = t('У списку');
          button.replaceWith(pill);
        })
      );
    } catch {
      // без банера вітрина однаково працює
    }
  }

  await load();
  return () => {
    clearTimeout(pollTimer);
    stopHero();
  };
}
