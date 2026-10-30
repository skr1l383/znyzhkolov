// «Історичний мінімум»: щоденні ціни вітрини і значок, коли дешевше ще не було.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, db, initDb } from '../server/db.js';
import { LOW_MIN_DAYS, historicLowSince, lowestPrice, recordDealPrices } from '../server/services/lows.js';
import { dealMessage } from '../server/services/notifier.js';

initDb(':memory:');
after(() => closeDb());

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const game = { store: 'steam', storeId: '620', currency: 'USD' };

test('За добу зберігається одна, найнижча ціна', () => {
  const at = daysAgo(30);
  recordDealPrices([{ ...game, price: 999, discount: 50 }], at);
  recordDealPrices([{ ...game, price: 1499, discount: 25 }], at); // подорожчала того ж дня — не перезаписує
  recordDealPrices([{ ...game, price: 799, discount: 60 }], at);
  const rows = db.prepare('SELECT price, discount FROM deal_prices WHERE store_id = ?').all('620');
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ price: 799, discount: 60 }]);
});

test('Значок: лише коли ціна не вища за мінімум і спостерігаємо досить довго', () => {
  recordDealPrices([{ ...game, price: 999, discount: 50 }], daysAgo(0));
  assert.equal(lowestPrice('steam', '620', 'USD').low, 799);
  assert.equal(historicLowSince({ ...game, price: 999, discount: 50 }), null, 'дорожче за мінімум');
  assert.equal(historicLowSince({ ...game, price: 799, discount: 60 }), daysAgo(30).slice(0, 10));
  assert.equal(historicLowSince({ ...game, price: 799, discount: 0 }), null, 'без знижки значок не потрібен');
  assert.equal(historicLowSince({ ...game, currency: 'UAH', price: 1, discount: 99 }), null, 'інша валюта — інша історія');

  recordDealPrices([{ store: 'gog', storeId: '1', currency: 'USD', price: 500, discount: 50 }], daysAgo(LOW_MIN_DAYS - 1));
  assert.equal(historicLowSince({ store: 'gog', storeId: '1', currency: 'USD', price: 500, discount: 50 }), null, 'замало днів');
});

test('Сповіщення про знижку згадує історичний мінімум', () => {
  const offer = { id: 1, store: 'steam', price_uah: 3300, discount: 60, available: 1 };
  const msg = dealMessage({ title: 'Portal 2' }, { min_discount: 50 }, { trigger: { offer } }, [offer], '2026-10-01');
  assert.match(msg.body, /Історичний мінімум: дешевше не було з 01\.10\.2026/);
  assert.match(msg.html, /📉 Історичний мінімум/);
  assert.doesNotMatch(dealMessage({ title: 'Portal 2' }, { min_discount: 50 }, { trigger: { offer } }, [offer]).body, /мінімум/);
});

test('Сповіщення про знижку англійською для того, хто вибрав англійську мову', () => {
  const offer = { id: 1, store: 'steam', price_uah: 3300, discount: 60, available: 1 };
  const msg = dealMessage({ title: 'Portal 2' }, { min_discount: 50 }, { trigger: { offer } }, [offer], '2026-10-01', 'en');
  assert.match(msg.title, /^Portal 2: .+ on Steam \(−60%\)$/);
  assert.match(msg.body, /Historical low: not this cheap since 01\.10\.2026\. Your condition: discount of 50% or more\./);
  assert.equal(msg.buttonLabel, 'Open on Steam');
  assert.doesNotMatch(`${msg.title} ${msg.body} ${msg.html}`, /[а-яіїєґ]/i);
});
