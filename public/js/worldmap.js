// Карта світу в SVG без бібліотек: контури країн з TopoJSON (world-atlas / Natural Earth,
// Крим — у складі України), проєкція Natural Earth, наближення кнопками й перетягування.
import { $, html, setHtml } from './ui.js';

const WIDTH = 1000;
const MAX_ZOOM = 8;

// Числові коди ISO 3166 з карти → двобуквені коди країн (ті, що потрібні для карти цін)
const ISO = {
  AT: '040', BE: '056', BG: '100', HR: '191', CY: '196', CZ: '203', DK: '208', EE: '233', FI: '246', FR: '250', DE: '276',
  GR: '300', HU: '348', IE: '372', IT: '380', LV: '428', LT: '440', LU: '442', MT: '470', NL: '528', PT: '620', RO: '642',
  SK: '703', SI: '705', ES: '724', SE: '752', UA: '804', US: '840', GB: '826', PL: '616', NO: '578', CH: '756', TR: '792',
  KZ: '398', IL: '376', SA: '682', AE: '784', ZA: '710', IN: '356', CN: '156', JP: '392', KR: '410', ID: '360', VN: '704',
  TH: '764', AU: '036', NZ: '554', CA: '124', MX: '484', AR: '032',
};
const ALPHA2 = Object.fromEntries(Object.entries(ISO).map(([a, n]) => [n, a]));

/** Проєкція Natural Earth: довгота й широта в радіанах → координати на площині. */
function naturalEarth(lambda, phi) {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

/** TopoJSON зберігає дуги як цілі зсуви від попередньої точки — розгортаємо їх у довготу й широту. */
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return naturalEarth(((x * sx + tx) * Math.PI) / 180, ((y * sy + ty) * Math.PI) / 180);
    });
  });
}

function toShapes(topo) {
  const arcs = decodeArcs(topo);
  const geoms = topo.objects.countries.geometries.filter((g) => g.id !== '010'); // без Антарктиди
  const polygons = (g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs);
  const ringOf = (indexes) => {
    const pts = [];
    for (const i of indexes) {
      const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      pts.push(...(pts.length ? arc.slice(1) : arc));
    }
    return pts;
  };

  // Межі всієї карти — щоб вписати її в ширину WIDTH
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const rings = geoms.map((g) => polygons(g).flatMap((p) => p.map(ringOf)));
  for (const pt of rings.flat(2)) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  const k = WIDTH / (maxX - minX);
  const height = Math.ceil((maxY - minY) * k);

  const path = (countryRings) =>
    countryRings
      .map((ring) => {
        let d = '';
        let prevX = null;
        for (const [rx, ry] of ring) {
          const x = (rx - minX) * k;
          const y = (maxY - ry) * k;
          // Стрибок через усю карту (лінія зміни дат) — починаємо нову частину контуру
          d += `${prevX === null || Math.abs(x - prevX) > WIDTH / 2 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          prevX = x;
        }
        return `${d}Z`;
      })
      .join('');

  return {
    width: WIDTH,
    height,
    shapes: geoms.map((g, i) => ({ code: ALPHA2[g.id] || null, d: path(rings[i]) })),
  };
}

let loading = null;
export function loadWorld() {
  loading ||= fetch('/vendor/world-110m.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(toShapes)
    .catch((err) => {
      loading = null; // наступного разу спробуємо ще
      throw err;
    });
  return loading;
}

/**
 * Малює карту в container. regionOf(code) → id регіону або null (країна без даних),
 * tone(regionId) → назва класу кольору, label(regionId) → текст для підказки й екранних читачів.
 * onSelect(regionId) — натискання на країну. Повертає { highlight(regionId), select(regionId) }.
 */
export function drawWorldMap(container, world, { regionOf, tone, label, onSelect, zoomLabels }) {
  setHtml(
    container,
    html`
      <div class="map-wrap">
        <svg class="world-map" viewBox="0 0 ${world.width} ${world.height}" role="group">
          <g>
            ${world.shapes.map((s) => {
              const region = s.code ? regionOf(s.code) : null;
              return region
                ? html`<path class="land has-data ${tone(region)}" d="${s.d}" data-region="${region}" tabindex="0" role="button" aria-label="${label(region)}"></path>`
                : html`<path class="land" d="${s.d}"></path>`;
            })}
          </g>
        </svg>
        <div class="map-tip" hidden></div>
        <div class="map-zoom">
          <button class="icon-btn" type="button" data-zoom="in" aria-label="${zoomLabels.in}">+</button>
          <button class="icon-btn" type="button" data-zoom="out" aria-label="${zoomLabels.out}">−</button>
          <button class="icon-btn" type="button" data-zoom="reset" aria-label="${zoomLabels.reset}">⟲</button>
        </div>
      </div>
    `
  );
  const svg = $('svg', container);
  const tip = $('.map-tip', container);
  const wrap = $('.map-wrap', container);
  const full = { x: 0, y: 0, w: world.width, h: world.height };
  let view = { ...full };

  const setView = (v) => {
    const w = Math.min(full.w, Math.max(full.w / MAX_ZOOM, v.w));
    const h = (w / full.w) * full.h;
    view = {
      w,
      h,
      x: Math.min(full.w - w, Math.max(0, v.x)),
      y: Math.min(full.h - h, Math.max(0, v.y)),
    };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    // Поки карта наближена, перетягування пальцем рухає карту, а не сторінку
    svg.classList.toggle('zoomed', view.w < full.w);
  };
  const zoom = (factor, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const w = view.w / factor;
    const h = view.h / factor;
    setView({ w, h, x: cx - (cx - view.x) / factor, y: cy - (cy - view.y) / factor });
  };

  container.querySelectorAll('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.zoom === 'reset' ? setView(full) : zoom(b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6)))
  );
  svg.addEventListener('dblclick', (e) => {
    const r = svg.getBoundingClientRect();
    zoom(2, view.x + ((e.clientX - r.left) / r.width) * view.w, view.y + ((e.clientY - r.top) / r.height) * view.h);
  });

  // Перетягування: якщо мишу зрушили, це не натискання на країну
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) svg.setPointerCapture(e.pointerId);
    drag.moved = true;
    const scale = view.w / svg.getBoundingClientRect().width;
    setView({ ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale });
  });
  const endDrag = (e) => {
    if (drag?.moved) e.preventDefault();
    setTimeout(() => (drag = null));
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', () => (drag = null));

  // Підсвітка всього регіону (наприклад, усіх країн з цінами в євро) і підказка біля курсора
  const highlight = (region) => {
    svg.querySelectorAll('.land.hl').forEach((p) => p.classList.remove('hl'));
    if (region) svg.querySelectorAll(`[data-region="${region}"]`).forEach((p) => p.classList.add('hl'));
  };
  const showTip = (region, x, y) => {
    setHtml(tip, label(region, true));
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(x - box.left, 8), box.width - tip.offsetWidth - 8);
    const top = y - box.top - tip.offsetHeight - 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top < 4 ? y - box.top + 18 : top}px`;
  };
  const hideTip = () => {
    tip.hidden = true;
    highlight(null);
  };

  svg.addEventListener('pointerover', (e) => {
    const region = e.target.dataset?.region;
    if (!region || drag?.moved) return;
    highlight(region);
    showTip(region, e.clientX, e.clientY);
  });
  svg.addEventListener('pointermove', (e) => {
    const region = e.target.dataset?.region;
    if (region && !drag?.moved) showTip(region, e.clientX, e.clientY);
  });
  svg.addEventListener('pointerout', (e) => {
    if (e.target.dataset?.region) hideTip();
  });
  svg.addEventListener('focusin', (e) => {
    const region = e.target.dataset?.region;
    if (!region) return;
    const r = e.target.getBoundingClientRect();
    highlight(region);
    showTip(region, r.left + r.width / 2, r.top);
  });
  svg.addEventListener('focusout', hideTip);
  svg.addEventListener('click', (e) => {
    const region = e.target.dataset?.region;
    if (region && !drag?.moved) onSelect(region);
  });
  svg.addEventListener('keydown', (e) => {
    const region = e.target.dataset?.region;
    if (region && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect(region);
    }
  });

  // Обведені країни малюємо останніми, щоб їхній контур не перекривали сусіди
  const raise = (selector) => svg.querySelectorAll(selector).forEach((p) => p.parentNode.appendChild(p));
  raise('.land.is-home');

  return {
    highlight,
    select: (region) => {
      svg.querySelectorAll('.land.selected').forEach((p) => p.classList.remove('selected'));
      if (!region) return;
      svg.querySelectorAll(`[data-region="${region}"]`).forEach((p) => p.classList.add('selected'));
      raise('.land.selected');
    },
  };
}
