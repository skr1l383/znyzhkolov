// Блок «Ціни в інших країнах» на сторінці гри: карта світу й список регіонів Steam,
// де видно, наскільки ціна для України вигідна порівняно з іншими країнами.
import { get } from '../api.js';
import { locale, t, tp } from '../i18n.js';
import { $, formatUah, html, setHtml, timeAgo } from '../ui.js';
import { drawWorldMap, loadWorld } from '../worldmap.js';

// Кольори карти: від «набагато дешевше, ніж в Україні» до «набагато дорожче»
const TONES = [
  [-25, 'tone-1', 'дешевше на 25% і більше'],
  [-5, 'tone-2', 'трохи дешевше'],
  [5, 'tone-3', 'приблизно як в Україні'],
  [50, 'tone-4', 'дорожче'],
  [Infinity, 'tone-5', 'дорожче на 50% і більше'],
];
const toneOf = (diff) => (diff == null ? 'tone-3' : TONES.find(([max]) => diff < max)[1]);

function regionName(id) {
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(id);
  } catch {
    return id;
  }
}

const localPrice = (r) => new Intl.NumberFormat(locale(), { style: 'currency', currency: r.currency }).format(r.price / 100);

function diffText(r) {
  if (r.id === 'UA') return t('ціна для України');
  if (r.diff == null) return '';
  if (r.diff <= -1) return t('на {n}% дешевше, ніж в Україні', { n: -r.diff });
  if (r.diff >= 1) return t('на {n}% дорожче, ніж в Україні', { n: r.diff });
  return t('як в Україні');
}

export function regionalSection() {
  return html`
    <section class="game-regional" id="regional" aria-labelledby="regional-title">
      <div class="section-title"><h2 id="regional-title">${t('Ціни в інших країнах')}</h2></div>
      <p class="hint">
        ${t('Steam продає ігри за цінами країни, до якої прив’язаний акаунт. Карта показує, наскільки ціна для України вигідна порівняно з іншими країнами — у гривнях за курсом НБУ.')}
      </p>
      <div id="regional-body"><div class="skeleton" style="height: 320px"></div></div>
    </section>
  `;
}

function summary(data) {
  const home = data.regions.find((r) => r.id === 'UA');
  const cheapest = data.regions[0];
  const pricier = home ? data.regions.filter((r) => r.priceUah > home.priceUah).length : 0;
  return html`
    <div class="regional-facts">
      ${home
        ? html`<div class="regional-fact">
            <span>${t('В Україні')}</span><b>${formatUah(home.priceUah)}</b>
            <small>${t('дешевше, ніж у {n} з {all} регіонів', { n: pricier, all: data.regions.length - 1 })}</small>
          </div>`
        : html`<div class="regional-fact"><span>${t('В Україні')}</span><b>—</b><small>${t('не продається')}</small></div>`}
      <div class="regional-fact is-good">
        <span>${t('Найдешевше')}</span><b>${formatUah(cheapest.priceUah)}</b><small>${regionName(cheapest.id)}</small>
      </div>
      <div class="regional-fact">
        <span>${t('Найдорожче')}</span><b>${formatUah(data.regions.at(-1).priceUah)}</b><small>${regionName(data.regions.at(-1).id)}</small>
      </div>
    </div>
  `;
}

function pickCard(r) {
  return html`
    <div class="regional-pick ${toneOf(r.diff)}">
      <div>
        <b>${regionName(r.id)}</b>
        <span class="muted">${localPrice(r)}${r.discount ? html` <span class="discount">−${r.discount}%</span>` : ''}</span>
      </div>
      <div class="regional-pick-price">
        <b>≈ ${formatUah(r.priceUah)}</b>
        <span>${diffText(r)}</span>
      </div>
    </div>
  `;
}

function draw(body, data, world) {
  const byId = new Map(data.regions.map((r) => [r.id, r]));
  const regionOf = new Map(data.regions.flatMap((r) => r.countries.map((c) => [c, r.id])));
  const max = data.regions.at(-1).priceUah;

  setHtml(
    body,
    html`
      ${summary(data)}
      <div class="regional-map" id="regional-map"></div>
      <ul class="map-legend" aria-label="${t('Легенда карти')}">
        ${TONES.map(([, tone, text]) => html`<li><i class="${tone}"></i>${t(text)}</li>`)}
        <li><i class="no-data"></i>${t('немає даних')}</li>
      </ul>
      <div id="regional-pick">${pickCard(byId.get('UA') || data.regions[0])}</div>
      <details class="regional-all">
        <summary>${t('Усі регіони ({n})', { n: data.regions.length })}</summary>
        <ol class="regional-list">
          ${data.regions.map(
            (r) => html`<li>
              <button type="button" class="regional-row ${r.id === 'UA' ? 'is-home' : ''}" data-region="${r.id}">
                <span class="regional-row-name">${regionName(r.id)}</span>
                <span class="regional-bar"><i class="${toneOf(r.diff)}" style="width: ${Math.max(4, Math.round((r.priceUah / max) * 100))}%"></i></span>
                <span class="regional-row-price">${formatUah(r.priceUah)}</span>
                <span class="regional-row-diff">${r.id === 'UA' || r.diff == null ? '' : `${r.diff > 0 ? '+' : ''}${r.diff}%`}</span>
              </button>
            </li>`
          )}
        </ol>
      </details>
      <p class="hint">${t('Ціни Steam оновлено {when}; гривні — за сьогоднішнім курсом НБУ.', { when: timeAgo(data.updatedAt) })}</p>
    `
  );

  const label = (id, rich) => {
    const r = byId.get(id);
    const name = id === 'EU' ? t('{name} (ціна в євро)', { name: regionName(id) }) : regionName(id);
    if (!rich) return `${name}: ${localPrice(r)} ≈ ${formatUah(r.priceUah)}. ${diffText(r)}`;
    return html`<b>${name}</b><span>${localPrice(r)} ≈ ${formatUah(r.priceUah)}</span><small>${diffText(r)}</small>`;
  };
  const select = (id) => {
    setHtml($('#regional-pick', body), pickCard(byId.get(id)));
    map.select(id);
  };
  const map = drawWorldMap($('#regional-map', body), world, {
    regionOf: (code) => regionOf.get(code) || null,
    tone: (id) => `${toneOf(byId.get(id).diff)} ${id === 'UA' ? 'is-home' : ''}`,
    label,
    onSelect: select,
    zoomLabels: { in: t('Наблизити'), out: t('Віддалити'), reset: t('Показати весь світ') },
  });

  const list = $('.regional-list', body);
  list.addEventListener('pointerover', (e) => map.highlight(e.target.closest('[data-region]')?.dataset.region || null));
  list.addEventListener('pointerleave', () => map.highlight(null));
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-region]');
    if (row) select(row.dataset.region);
  });
}

/** Завантажує ціни, щойно блок наближається до екрана, — щоб не питати Steam даремно. */
export function mountRegional(root, appId) {
  const section = $('#regional', root);
  const body = $('#regional-body', root);
  const load = async () => {
    try {
      const [data, world] = await Promise.all([get(`/api/games/steam/${encodeURIComponent(appId)}/regional`), loadWorld()]);
      if (!data.regions.length) {
        setHtml(body, html`<p class="muted">${t('Гра безкоштовна або зараз не продається — порівнювати нічого.')}</p>`);
        return;
      }
      draw(body, data, world);
    } catch (err) {
      setHtml(
        body,
        html`<div class="regional-error"><p class="muted">${err.message}</p>
          <button class="btn btn-sm" type="button" id="regional-retry">${t('Спробувати ще раз')}</button></div>`
      );
      $('#regional-retry', body).addEventListener('click', () => {
        setHtml(body, html`<div class="skeleton" style="height: 320px"></div>`);
        load();
      });
    }
  };
  if (!('IntersectionObserver' in window)) return load();
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      load();
    },
    { rootMargin: '300px' }
  );
  observer.observe(section);
}
