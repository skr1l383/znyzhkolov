// Перевірка розбору відповідей магазинів. Структура тестових даних
// повторює справжні відповіді Steam, GOG, Epic Games і НБУ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamPrices, parseSteamSearch } from '../server/stores/steam.js';
import { parseGogCatalog } from '../server/stores/gog.js';
import { parseEpicFreebies } from '../server/stores/epic.js';
import { parseNbuRate } from '../server/stores/currency.js';
import { discountPercent, formatUah, safeImageUrl, toMinor } from '../server/stores/util.js';

test('Steam: пошук повертає ігри з цінами в гривнях', () => {
  const json = {
    total: 2,
    items: [
      {
        type: 'app',
        name: 'Hades',
        id: 1145360,
        price: { currency: 'UAH', initial: 51500, final: 25750 },
        tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/capsule_231x87.jpg',
      },
      { type: 'app', name: 'Dota 2', id: 570, tiny_image: 'http://evil.example.com/x.jpg' },
    ],
  };
  const [hades, dota] = parseSteamSearch(json);
  assert.equal(hades.storeId, '1145360');
  assert.equal(hades.price, 25750);
  assert.equal(hades.discount, 50);
  assert.equal(hades.url, 'https://store.steampowered.com/app/1145360/');
  assert.equal(dota.price, null);
  assert.equal(dota.imageUrl, null, 'картинки не з CDN Steam відкидаються');
});

test('Steam: ціни з appdetails, безкоштовні та недоступні ігри', () => {
  const json = {
    1145360: { success: true, data: { price_overview: { currency: 'UAH', initial: 51500, final: 51500, discount_percent: 0 } } },
    570: { success: true, data: [] },
    999: { success: false },
    10: { success: true, data: { price_overview: { currency: 'UAH', initial: 9900, final: 0, discount_percent: 100 } } },
  };
  const map = parseSteamPrices(json);
  assert.deepEqual(map.get('1145360'), { available: true, currency: 'UAH', price: 51500, basePrice: 51500, discount: 0, isFree: false });
  assert.equal(map.get('570').price, null);
  assert.equal(map.get('999').available, false);
  assert.equal(map.get('10').isFree, true, 'ціна 0 при базовій > 0 — це роздача');
});

test('GOG: каталог, ціни в доларах, DLC відкидаються', () => {
  const json = {
    products: [
      {
        id: '1207664663',
        title: 'The Witcher 3: Wild Hunt',
        slug: 'the_witcher_3_wild_hunt',
        productType: 'game',
        storeLink: 'https://www.gog.com/en/game/the_witcher_3_wild_hunt',
        coverHorizontal: 'https://images.gog-statics.com/abc.jpg',
        price: { final: '$13.99', base: '$34.99', finalMoney: { amount: '13.99', currency: 'USD', discount: '21.00' }, baseMoney: { amount: '34.99', currency: 'USD' } },
      },
      { id: '1', title: 'Soundtrack', productType: 'dlc', price: null },
    ],
  };
  const res = parseGogCatalog(json);
  assert.equal(res.length, 1);
  assert.equal(res[0].price, 1399);
  assert.equal(res[0].basePrice, 3499);
  assert.equal(res[0].discount, 60);
  assert.equal(res[0].currency, 'USD');
});

test('Epic: поточні та майбутні роздачі, звичайні знижки ігноруються', () => {
  const nowDate = new Date('2026-10-11T12:00:00Z');
  const json = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: 'a',
              title: 'Free Now',
              catalogNs: { mappings: [{ pageSlug: 'free-now', pageType: 'productHome' }] },
              keyImages: [{ type: 'Thumbnail', url: 'https://cdn1.epicgames.com/a.jpg' }],
              price: { totalPrice: { originalPrice: 27900, discountPrice: 0, currencyCode: 'UAH' } },
              promotions: {
                promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-09T15:00:00.000Z', endDate: '2026-10-16T15:00:00.000Z', discountSetting: { discountType: 'PERCENTAGE', discountPercentage: 0 } }] }],
                upcomingPromotionalOffers: [],
              },
            },
            {
              id: 'b',
              title: 'Next Week',
              productSlug: 'next-week/home',
              price: { totalPrice: { originalPrice: 15000, currencyCode: 'UAH' } },
              promotions: {
                promotionalOffers: [],
                upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-16T15:00:00.000Z', endDate: '2026-10-23T15:00:00.000Z', discountSetting: { discountPercentage: 0 } }] }],
              },
            },
            {
              id: 'c',
              title: 'Just A Sale',
              promotions: { promotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 80 } }] }] },
            },
            { id: 'd', title: 'No promo', promotions: null },
          ],
        },
      },
    },
  };
  const res = parseEpicFreebies(json, nowDate);
  assert.equal(res.length, 2);
  assert.equal(res[0].status, 'current');
  assert.equal(res[0].url, 'https://store.epicgames.com/uk/p/free-now');
  assert.equal(res[0].originalPrice, 27900);
  assert.equal(res[1].status, 'upcoming');
  assert.equal(res[1].url, 'https://store.epicgames.com/uk/p/next-week');
});

test('НБУ: курс долара', () => {
  assert.deepEqual(parseNbuRate([{ r030: 840, txt: 'Долар США', rate: 41.45, cc: 'USD', exchangedate: '12.10.2026' }]), {
    rate: 41.45,
    date: '12.10.2026',
  });
  assert.equal(parseNbuRate([]), null);
});

test('Гроші: копійки, відсотки, формат', () => {
  assert.equal(toMinor('13.99'), 1399);
  assert.equal(toMinor(null), null);
  assert.equal(discountPercent(51500, 25750), 50);
  assert.equal(discountPercent(100, 120), 0);
  assert.equal(formatUah(51500), '515 ₴');
  assert.equal(formatUah(13654), '136,54 ₴');
  assert.equal(formatUah(129900), '1 299 ₴');
  assert.equal(safeImageUrl('https://images.gog-statics.com/x.jpg'), 'https://images.gog-statics.com/x.jpg');
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
});
