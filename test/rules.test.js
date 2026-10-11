// Перевірка логіки: збіг назв між магазинами та умови сповіщень.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankMatches, titleScore } from '../server/stores/match.js';
import { bestOffer, evaluateWatch } from '../server/services/watch.js';
import { demoHistory } from '../server/stores/demo.js';

test('Назви: та сама гра з різними підписами', () => {
  assert.equal(titleScore('Stardew Valley', 'Stardew Valley'), 1);
  assert.equal(titleScore('The Witcher 3: Wild Hunt', 'The Witcher® 3: Wild Hunt — Complete Edition'), 0.9);
  assert.equal(titleScore('Disco Elysium - The Final Cut', 'Disco Elysium – The Final Cut'), 1);
});

test('Назви: різні частини серії не плутаються', () => {
  assert.equal(titleScore('Hades', 'Hades II'), 0);
  assert.equal(titleScore('The Witcher 2', 'The Witcher 3'), 0);
  const ranked = rankMatches('Cyberpunk 2077', [
    { title: 'Cyberpunk 2077: Phantom Liberty' },
    { title: 'Cyberpunk 2077' },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, 'Cyberpunk 2077');
});

const offer = (o) => ({ available: 1, is_free: 0, discount: 0, price: 1000, price_uah: 1000, ...o });

test('Умова: знижка від N%', () => {
  const watch = { min_discount: 50, max_price_uah: null, notify_free: 1 };
  assert.equal(evaluateWatch(watch, [offer({ store: 'steam', discount: 40 })]).met, false);
  const ev = evaluateWatch(watch, [offer({ store: 'steam', discount: 40 }), offer({ store: 'gog', discount: 60, price_uah: 800 })]);
  assert.equal(ev.met, true);
  assert.equal(ev.trigger.offer.store, 'gog');
  assert.deepEqual(ev.trigger.reasons, ['discount']);
});

test('Умова: ціна до N грн обирає найдешевший магазин', () => {
  const watch = { min_discount: null, max_price_uah: 30000, notify_free: 0 };
  const ev = evaluateWatch(watch, [
    offer({ store: 'steam', price: 29900, price_uah: 29900 }),
    offer({ store: 'gog', price: 699, price_uah: 28970 }),
  ]);
  assert.equal(ev.met, true);
  assert.equal(ev.trigger.offer.store, 'gog');
  assert.equal(ev.key, 'gog:699:0');
});

test('Умова: безкоштовна роздача; недоступні та безцінові пропозиції ігноруються', () => {
  const watch = { min_discount: null, max_price_uah: null, notify_free: 1 };
  assert.equal(evaluateWatch(watch, [offer({ price: null, price_uah: null })]).met, false);
  assert.equal(evaluateWatch(watch, [offer({ available: 0, is_free: 1, price: 0, price_uah: 0 })]).met, false);
  assert.equal(evaluateWatch(watch, [offer({ is_free: 1, price: 0, price_uah: 0, discount: 100 })]).met, true);
});

test('Найкраща ціна серед магазинів', () => {
  const best = bestOffer([offer({ store: 'steam', price_uah: 51500 }), offer({ store: 'gog', price_uah: 41000 }), offer({ store: 'x', price_uah: null })]);
  assert.equal(best.store, 'gog');
});

test('Демо-історія цін: по точці на добу, знижки в межах розумного', () => {
  const points = demoHistory(51500, 120);
  assert.equal(points.length, 120);
  const times = points.map((p) => new Date(p.at).getTime());
  assert.ok(times.every((t, i) => !i || t > times[i - 1]), 'точки йдуть від старих до нових');
  assert.ok(times.at(-1) < Date.now(), 'історія закінчується до сьогоднішньої перевірки');
  assert.ok(points.every((p) => p.basePrice === 51500 && p.price <= 51500 && p.discount >= 0 && p.discount <= 75));
  assert.ok(points.some((p) => p.discount > 0), 'за 4 місяці є хоча б один розпродаж');
  assert.deepEqual(demoHistory(null), []);
});
