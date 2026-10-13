// Сторінка гри: трейлер і скриншоти, опис, рейтинг, ціни в обох магазинах,
// кнопки «Купити» (ведуть у магазин) і «Стежити за ціною».
import { get } from '../api.js';
import { go, state } from '../app.js';
import { $, STORE_NAMES, formatMoney, formatUah, html, setHtml, toast } from '../ui.js';
import { openAddDialog } from './search.js';

const REVIEWS_UK = {
  'Overwhelmingly Positive': 'Надзвичайно схвальні',
  'Very Positive': 'Дуже схвальні',
  Positive: 'Схвальні',
  'Mostly Positive': 'Здебільшого схвальні',
  Mixed: 'Неоднозначні',
  'Mostly Negative': 'Здебільшого негативні',
  Negative: 'Негативні',
  'Very Negative': 'Дуже негативні',
  'Overwhelmingly Negative': 'Надзвичайно негативні',
};
const PLATFORMS = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
const DESCRIPTION_PREVIEW = 6;

/** Трейлери Steam — потокове відео HLS. Safari вміє його сам, іншим браузерам допомагає hls.js. */
let hlsLoading = null;
function loadHls() {
  hlsLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/hls.min.js';
    script.onload = () => resolve(window.Hls);
    script.onerror = () => reject(new Error('Не вдалося завантажити програвач відео'));
    document.head.append(script);
  });
  return hlsLoading;
}

function offerCard(o, best) {
  const usd = o.currency === 'USD' && o.price != null ? `${formatMoney(o.price, 'USD')} за курсом НБУ` : '';
  const price = o.price == null ? 'Ціни немає' : o.price === 0 ? 'Безкоштовно' : `${usd ? '≈ ' : ''}${formatUah(o.priceUah)}`;
  return html`
    <div class="buy-row ${best ? 'best' : ''}">
      <div class="buy-info">
        <span class="store store-${o.store}">${STORE_NAMES[o.store]}</span>
        ${best ? html`<span class="best-label">Найдешевше</span>` : ''}
        <div class="buy-prices" title="${usd}">
          ${o.discount > 0 ? html`<span class="discount">−${o.discount}%</span>` : ''}
          ${o.discount > 0 && o.basePriceUah ? html`<span class="price-old">${formatUah(o.basePriceUah)}</span>` : ''}
          <span class="price">${price}</span>
        </div>
      </div>
      <a class="btn ${best ? 'btn-primary' : ''}" href="${o.url}" target="_blank" rel="noopener noreferrer">Купити в ${STORE_NAMES[o.store]}</a>
    </div>
  `;
}

function mediaThumb(m, i) {
  return html`
    <button class="media-thumb ${m.kind !== 'image' ? 'is-video' : ''}" type="button" data-media="${i}"
      aria-label="${m.kind === 'image' ? `Скриншот ${i + 1}` : m.title}">
      <img src="${m.poster || m.thumb}" alt="" loading="lazy" />
    </button>`;
}

export async function render(root, params) {
  const store = params.store;
  const id = params.id;
  setHtml(root, html`<div class="stack"><div class="skeleton" style="height: 320px"></div><div class="skeleton"></div></div>`);
  const g = await get(`/api/games/${encodeURIComponent(store)}/${encodeURIComponent(id)}`);
  document.title = `${g.title} · Знижколов`;

  // Спочатку трейлери, потім скриншоти — одна стрічка мініатюр
  const media = [
    ...g.videos.map((v) => ({ ...v })),
    ...g.screenshots.map((s) => ({ kind: 'image', thumb: s.thumb, full: s.full })),
  ];
  const priced = g.offers.filter((o) => o.priceUah != null);
  const best = priced.length > 1 ? priced.reduce((a, b) => (b.priceUah < a.priceUah ? b : a)) : null;
  const meta = [g.developers.join(', '), g.releaseDate, g.platforms.map((p) => PLATFORMS[p] || p).join(' · ')].filter(Boolean);

  setHtml(
    root,
    html`
      <article class="game-page">
        <header class="game-hero">
          ${g.background ? html`<img class="game-hero-bg" src="${g.background}" alt="" />` : ''}
          <div class="game-hero-inner">
            <a class="back-link" href="#/" data-back>← Назад</a>
            <h1>${g.title}</h1>
            ${g.genres.length ? html`<div class="chips">${g.genres.map((x) => html`<span class="chip">${x}</span>`)}</div>` : ''}
            ${meta.length ? html`<p class="game-meta">${meta.join(' · ')}</p>` : ''}
          </div>
        </header>

        <div class="game-layout">
          <div class="game-main">
            ${media.length
              ? html`<div class="media-viewer" id="viewer"></div>
                  <div class="media-strip" role="list">${media.map(mediaThumb)}</div>`
              : g.headerImage
                ? html`<img class="media-single" src="${g.headerImage}" alt="" />`
                : ''}

            <section class="game-about">
              <h2>Про гру</h2>
              ${g.shortDescription ? html`<p class="lead">${g.shortDescription}</p>` : ''}
              ${g.description.length
                ? html`<div class="description ${g.description.length > DESCRIPTION_PREVIEW ? 'collapsed' : ''}">
                      ${g.description.map((p) => (p.startsWith('• ') ? html`<p class="bullet">${p.slice(2)}</p>` : html`<p>${p}</p>`))}
                    </div>
                    ${g.description.length > DESCRIPTION_PREVIEW ? html`<button class="btn btn-ghost btn-sm" type="button" id="more-desc">Читати далі</button>` : ''}`
                : html`<p class="muted">${g.limited ? 'Магазин зараз не відповідає, тому показуємо лише основне. Спробуй оновити сторінку пізніше.' : 'Опису поки немає.'}</p>`}
            </section>
          </div>

          <aside class="game-side">
            ${g.headerImage ? html`<img class="game-side-cover" src="${g.headerImage}" alt="" />` : ''}
            ${g.reviews || g.metacritic
              ? html`<div class="game-scores">
                  ${g.reviews
                    ? html`<div><strong>${g.reviews.percent}%</strong><span>${REVIEWS_UK[g.reviews.summary] || 'схвальних відгуків'}</span>
                        <small>${g.reviews.total.toLocaleString('uk-UA')} відгуків у Steam</small></div>`
                    : ''}
                  ${g.metacritic ? html`<div><strong>${g.metacritic}</strong><span>Metacritic</span></div>` : ''}
                </div>`
              : ''}

            <div class="buy-box">
              ${g.offers.map((o) => offerCard(o, best && o.store === best.store))}
            </div>

            <div class="watch-box">
              ${g.watchId
                ? html`<span class="pill pill-good">Ти стежиш за цією грою</span>
                    <a class="btn btn-sm" href="#/list">Відкрити мій список</a>`
                : html`<button class="btn btn-primary btn-block" type="button" id="watch">Стежити за ціною</button>
                    <p class="hint">Повідомимо на сайті й у Telegram, щойно гра подешевшає до твоєї ціни.</p>`}
            </div>
            ${g.publishers.length ? html`<p class="hint">Видавець: ${g.publishers.join(', ')}</p>` : ''}
          </aside>
        </div>
      </article>
    `
  );

  // «Назад» повертає туди, звідки прийшли (вітрина з фільтрами, список, пошук)
  $('[data-back]', root).addEventListener('click', (e) => {
    if (history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });

  $('#more-desc', root)?.addEventListener('click', (e) => {
    $('.description', root).classList.remove('collapsed');
    e.currentTarget.remove();
  });

  $('#watch', root)?.addEventListener('click', () => {
    if (!state.user) {
      toast('Створи акаунт або увійди, щоб стежити за цінами');
      return go('#/register');
    }
    const offer = best || g.offers[0];
    openAddDialog(offer, { onAdded: () => render(root, params) });
  });

  // ---- Галерея: трейлер або скриншот у великому вікні ----
  let hls = null;
  const viewer = $('#viewer', root);
  const show = async (i) => {
    const m = media[i];
    if (!viewer || !m) return;
    hls?.destroy();
    hls = null;
    root.querySelectorAll('[data-media]').forEach((b) => b.classList.toggle('active', Number(b.dataset.media) === i));
    if (m.kind === 'image') {
      setHtml(viewer, html`<img src="${m.full}" alt="Скриншот ${g.title}" />`);
    } else if (m.kind === 'youtube') {
      setHtml(viewer, html`<iframe src="${m.src}?autoplay=1&rel=0" title="${m.title}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`);
    } else {
      setHtml(viewer, html`<video controls playsinline poster="${m.poster || ''}" aria-label="${m.title}"></video>`);
      const video = $('video', viewer);
      video.muted = true; // браузери дозволяють автозапуск лише без звуку; звук вмикається в програвачі
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = m.src;
      } else {
        try {
          const Hls = await loadHls();
          if (!Hls.isSupported()) throw new Error('Браузер не вміє програвати це відео');
          hls = new Hls({ enableWorker: false, capLevelToPlayerSize: true });
          hls.loadSource(m.src);
          hls.attachMedia(video);
        } catch (err) {
          setHtml(viewer, html`<div class="media-error"><p>${err.message}</p></div>`);
          return;
        }
      }
      video.play().catch(() => {});
    }
  };
  root.querySelector('.media-strip')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-media]');
    if (btn) show(Number(btn.dataset.media));
  });
  // Спершу показуємо перший скриншот, щоб відео не вмикалося саме; трейлер — першою мініатюрою
  if (media.length) {
    const firstImage = media.findIndex((m) => m.kind === 'image');
    show(firstImage >= 0 ? firstImage : 0);
  }

  return () => hls?.destroy();
}
