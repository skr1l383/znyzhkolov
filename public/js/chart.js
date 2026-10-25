// Графік історії ціни. Малюється вручну в SVG, без бібліотек:
// по лінії на кожен магазин, перехрестя з підказкою при наведенні, позначка мінімуму.
import { $, STORE_NAMES, formatUah, html, setHtml } from './ui.js';
import { locale, t } from './i18n.js';

const DAY = 864e5;
const HEIGHT = 260;
const STORE_ORDER = ['steam', 'gog', 'keys'];
const RANGES = [
  { days: 30, label: '30 днів' },
  { days: 90, label: '90 днів' },
  { days: 0, label: 'Усе' },
];

const shortDate = (t) => new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const longDate = (t) => new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = (t) =>
  new Date(t).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Відповідь /api/watch/:id/history → масив серій з точками { t (мс), v (копійки), discount }. */
function prepare(raw) {
  return Object.entries(raw || {})
    .map(([store, pts]) => ({
      store,
      points: pts
        .filter((p) => p.priceUah != null)
        .map((p) => ({ t: new Date(p.t).getTime(), v: p.priceUah, discount: p.discount || 0 })),
    }))
    .filter((s) => s.points.length)
    .sort((a, b) => STORE_ORDER.indexOf(a.store) - STORE_ORDER.indexOf(b.store));
}

/** Ціна діє до наступної зміни, тож значення в момент t — це остання точка не пізніше t. */
function valueAt(s, t) {
  let found = null;
  for (const p of s.points) {
    if (p.t > t) break;
    found = p;
  }
  return found;
}

/** Точки серії всередині проміжку [from, to], продовжені до його країв. */
function segment(s, from, to) {
  const out = [];
  const start = valueAt(s, from);
  if (start) out.push({ ...start, t: from });
  out.push(...s.points.filter((p) => p.t > from && p.t <= to));
  if (out.length) out.push({ ...out[out.length - 1], t: to });
  return out;
}

/** «Кругла» верхня межа шкали та крок поділок: 1, 2 або 5 × 10ⁿ. */
function niceScale(max, ticks = 4) {
  const raw = Math.max(max, 100) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return { step, top: Math.ceil((max * 1.05) / step) * step };
}

/** Зміни ціни (без повторів щодобових записів) — для таблиці. */
function changes(series, from, to) {
  const rows = [];
  for (const s of series) {
    let prev = null;
    for (const p of s.points) {
      if (p.v !== prev && p.t >= from && p.t <= to) rows.push({ store: s.store, ...p });
      prev = p.v;
    }
  }
  return rows.sort((a, b) => b.t - a.t);
}

export function priceChart(container, rawSeries) {
  const series = prepare(rawSeries);
  if (!series.length) {
    setHtml(container, html`<p class="muted">${t("Історії цін ще немає. Вона з'явиться після першої перевірки цін.")}</p>`);
    return;
  }

  const first = Math.min(...series.map((s) => s.points[0].t));
  const spanDays = (Date.now() - first) / DAY;
  // Кнопки 30/90 днів показуємо, лише коли історія довша за цей період
  const ranges = RANGES.filter((r) => !r.days || r.days < spanDays);
  let range = spanDays > 90 ? 90 : 0;
  let cursor = null;

  setHtml(
    container,
    html`
      <div class="chart-top">
        <div class="chart-stats"></div>
        ${ranges.length > 1
          ? html`<div class="segmented" role="group" aria-label="${t('Період')}">
              ${ranges.map((r) => html`<button type="button" data-days="${r.days}" aria-pressed="${String(r.days === range)}">${t(r.label)}</button>`)}
            </div>`
          : ''}
      </div>
      <div class="chart-legend">
        ${series.map((s) => html`<span class="legend-item series-${s.store}"><span class="legend-line"></span>${STORE_NAMES[s.store]}</span>`)}
      </div>
      <div class="chart-plot" tabindex="0" role="img"></div>
      <p class="hint">
        ${spanDays < 7
          ? t("Історія збирається з {date}. Ціни перевіряються автоматично, і кожна зміна з'явиться тут.", { date: longDate(first) })
          : t('Ціни в гривнях. Ціни GOG перераховано за курсом НБУ на день перевірки.')}
        ${t('Наведи на графік (або вибери його і натискай ← →), щоб побачити ціну на будь-який день.')}
      </p>
      <details class="chart-table">
        <summary>${t('Показати зміни ціни таблицею')}</summary>
        <div class="table-wrap"></div>
      </details>
    `
  );

  const plot = $('.chart-plot', container);
  let geo = null; // розміри й шкали останнього малюнка, потрібні для підказки

  function draw() {
    const now = Date.now();
    let from = range ? now - range * DAY : first;
    if (now - from < DAY) from = now - DAY;

    const width = Math.max(280, plot.clientWidth);
    const narrow = width < 520;
    const pad = { top: 22, right: narrow ? 52 : 64, bottom: 28, left: narrow ? 58 : 70 };
    const w = width - pad.left - pad.right;
    const h = HEIGHT - pad.top - pad.bottom;
    const visible = series.map((s) => ({ ...s, seg: segment(s, from, now) })).filter((s) => s.seg.length);
    const { step, top } = niceScale(Math.max(...visible.flatMap((s) => s.seg.map((p) => p.v))));
    const x = (t) => pad.left + ((t - from) / (now - from)) * w;
    const y = (v) => pad.top + h - (v / top) * h;
    geo = { from, now, pad, w, width, x, y };

    // Сітка й підписи осі Y (від нуля, щоб глибина знижки була видна чесно)
    const yTicks = [];
    for (let v = 0; v <= top; v += step) yTicks.push(v);
    const tickCount = narrow ? 3 : 5;
    const xTicks = Array.from({ length: tickCount }, (_, i) => from + (i * (now - from)) / (tickCount - 1));

    // Ступінчаста лінія: ціна тримається до наступної зміни
    const path = (seg) =>
      seg.map((p, i) => (i ? `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)).join('');

    // Найнижча ціна за період — одна позначка на весь графік
    let min = null;
    for (const s of visible) {
      for (const p of s.seg.slice(0, -1)) if (!min || p.v < min.v) min = { ...p, store: s.store };
    }
    const minX = x(min.t);
    const minAnchor = minX < pad.left + 60 ? 'start' : minX > pad.left + w - 60 ? 'end' : 'middle';

    // Підписи в кінці ліній, розсунуті, щоб не налазили один на одного
    const ends = visible
      .map((s) => ({ store: s.store, y: y(s.seg[s.seg.length - 1].v) }))
      .sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => {
      if (i && e.y < ends[i - 1].y + 15) e.y = ends[i - 1].y + 15;
    });

    setHtml(
      plot,
      html`
        <svg viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}" aria-hidden="true">
          ${yTicks.map(
            (v) => html`
              <line class="chart-grid" x1="${pad.left}" x2="${pad.left + w}" y1="${y(v)}" y2="${y(v)}"></line>
              <text class="chart-axis" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${formatUah(v)}</text>
            `
          )}
          ${xTicks.map(
            (t, i) => html`<text class="chart-axis" x="${x(t)}" y="${HEIGHT - 8}"
              text-anchor="${i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}">${shortDate(t)}</text>`
          )}
          ${visible.map((s) => html`<path class="chart-line series-${s.store}" d="${path(s.seg)}"></path>`)}
          ${ends.map((e) => html`<text class="chart-end-label" x="${pad.left + w + 8}" y="${e.y + 4}">${STORE_NAMES[e.store]}</text>`)}
          <circle class="chart-min-dot" cx="${minX}" cy="${y(min.v)}" r="5"></circle>
          <text class="chart-min-label" x="${minX}" y="${y(min.v) - 10}" text-anchor="${minAnchor}">${t('мін.')} ${formatUah(min.v)}</text>
          <g class="chart-hover" style="display: none">
            <line class="chart-cross" y1="${pad.top}" y2="${pad.top + h}"></line>
            ${visible.map((s) => html`<circle class="chart-dot series-${s.store}" r="5" data-store="${s.store}"></circle>`)}
          </g>
        </svg>
        <div class="chart-tip" hidden></div>
      `
    );

    // Підсумок над графіком
    const current = visible
      .map((s) => ({ store: s.store, v: s.seg[s.seg.length - 1].v }))
      .sort((a, b) => a.v - b.v)[0];
    const maxDiscount = Math.max(...visible.flatMap((s) => s.seg.map((p) => p.discount)));
    setHtml(
      $('.chart-stats', container),
      html`
        <div class="chart-stat"><span>${t('Зараз найдешевше')}</span><strong>${formatUah(current.v)}</strong><small>${STORE_NAMES[current.store]}</small></div>
        <div class="chart-stat"><span>${t('Мінімум за період')}</span><strong>${formatUah(min.v)}</strong><small>${STORE_NAMES[min.store]}, ${shortDate(min.t)}</small></div>
        <div class="chart-stat"><span>${t('Найбільша знижка')}</span><strong>${maxDiscount ? `−${maxDiscount}%` : t('не було')}</strong></div>
      `
    );
    plot.setAttribute(
      'aria-label',
      t('Графік ціни. Зараз найдешевше {price} у {store}, мінімум за період {min}.', { price: formatUah(current.v), store: STORE_NAMES[current.store], min: formatUah(min.v) })
    );

    const rows = changes(series, from, now);
    setHtml(
      $('.chart-table .table-wrap', container),
      html`<table class="table">
        <thead><tr><th>${t('Дата')}</th><th>${t('Магазин')}</th><th>${t('Ціна')}</th><th>${t('Знижка')}</th></tr></thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr><td class="nowrap">${dateTime(r.t)}</td><td>${STORE_NAMES[r.store]}</td>
              <td class="nowrap">${formatUah(r.v)}</td><td>${r.discount ? `−${r.discount}%` : '—'}</td></tr>`
          )}
        </tbody>
      </table>`
    );

    if (cursor != null) showAt(cursor);
  }

  function showAt(t) {
    const { from, now, pad, w, width, x, y } = geo;
    cursor = Math.min(now, Math.max(from, t));
    const cx = x(cursor);
    const hover = $('.chart-hover', plot);
    const tip = $('.chart-tip', plot);
    hover.style.display = '';
    const cross = $('.chart-cross', hover);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);

    const rows = [];
    for (const s of series) {
      const dot = $(`[data-store="${s.store}"]`, hover);
      const p = valueAt(s, cursor);
      if (dot) dot.style.display = p ? '' : 'none';
      if (!p) continue;
      dot?.setAttribute('cx', cx);
      dot?.setAttribute('cy', y(p.v));
      rows.push(html`<div class="chart-tip-row series-${s.store}">
        <span><span class="legend-line"></span>${STORE_NAMES[s.store]}</span>
        <strong>${formatUah(p.v)}${p.discount ? html` <span class="discount">−${p.discount}%</span>` : ''}</strong>
      </div>`);
    }
    setHtml(tip, html`<div class="chart-tip-date">${longDate(cursor)}</div>${rows.length ? rows : html`<div class="muted">${t('Ще не відстежувалось')}</div>`}`);
    tip.hidden = false;
    // Підказка з того боку від перехрестя, де більше місця
    const scale = plot.clientWidth / width;
    const flip = cx > pad.left + w / 2;
    tip.classList.toggle('flip', flip);
    tip.style.left = `${(flip ? cx - 12 : cx + 12) * scale}px`;
  }

  function hide() {
    cursor = null;
    $('.chart-hover', plot).style.display = 'none';
    $('.chart-tip', plot).hidden = true;
  }

  plot.addEventListener('pointermove', (e) => {
    const { from, now, pad, w, width } = geo;
    const px = ((e.clientX - plot.getBoundingClientRect().left) * width) / plot.clientWidth;
    if (px < pad.left || px > pad.left + w) return hide();
    showAt(from + ((px - pad.left) / w) * (now - from));
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hide();
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    showAt((cursor ?? geo.now) + (e.key === 'ArrowLeft' ? -DAY : DAY));
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    range = Number(btn.dataset.days);
    container.querySelectorAll('[data-days]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    draw();
  });

  // Перемальовуємо при зміні ширини вікна; спостерігач сам вимикається, коли графік закрили
  const observer = new ResizeObserver(() => (container.isConnected ? draw() : observer.disconnect()));
  observer.observe(plot);
  draw();
}
