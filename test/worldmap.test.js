// Контури країн для карти цін (public/vendor/world-110m.json): Крим — у складі України.
// У вихідних даних Natural Earth його віднесено до росії, тому файл виправлено; тест стежить, щоб так і лишалося.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const topo = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'vendor', 'world-110m.json'), 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
});
const ring = (indexes) => indexes.flatMap((i, n) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i]).slice(n ? 1 : 0));
const polygons = (g) => (g.type === 'Polygon' ? [g.arcs] : g.arcs);
const inside = ([px, py], pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const countryAt = (point) =>
  topo.objects.countries.geometries.find((g) => polygons(g).some((p) => inside(point, ring(p[0])) && !p.slice(1).some((h) => inside(point, ring(h)))))?.id;

test('Карта: Крим (Сімферополь, Керч, Севастополь) — у складі України', () => {
  assert.equal(countryAt([34.1, 44.95]), '804', 'Сімферополь');
  assert.equal(countryAt([36.4, 45.3]), '804', 'Керч');
  assert.equal(countryAt([33.55, 44.6]), '804', 'Севастополь');
  assert.equal(countryAt([30.52, 50.45]), '804', 'Київ');
  assert.equal(countryAt([37.6, 55.75]), '643', 'Москва — не Україна');
});

test('Карта: Україна — один суцільний контур, без лінії по Перекопу', () => {
  const ua = topo.objects.countries.geometries.find((g) => g.id === '804');
  assert.equal(ua.type, 'Polygon');
  assert.equal(ua.arcs.length, 1, 'одне кільце без дірок');
  const used = (g) => polygons(g).flat(2).map((i) => (i < 0 ? ~i : i));
  const uaArcs = used(ua);
  assert.equal(new Set(uaArcs).size, uaArcs.length, 'жодна дуга не повторюється (немає внутрішнього кордону)');
});
