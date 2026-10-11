// Перевірка розбору відповідей магазинів. Структура тестових даних
// повторює справжні відповіді Steam, GOG, Epic Games і НБУ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamPrices, parseSteamSearch } from '../server/stores/steam.js';
import { parseGogCatalog } from '../server/stores/gog.js';
import { parseEpicFreebies } from '../server/stores/epic.js';
import { parseNbuRate } from '../server/stores/currency.js';
import { parseGogDeals, parseSteamSpecials } from '../server/stores/deals.js';
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

// Фрагмент справжньої сторінки https://store.steampowered.com/search/results/?specials=1 (скорочено)
const STEAM_SPECIALS_HTML = `
<!-- List Items -->
  <a href="https://store.steampowered.com/app/632360/Risk_of_Rain_2/?snr=1_7_7_2300_150_1"
   data-ds-appid="632360" data-ds-itemkey="App_632360" data-ds-tagids="[3814,42804]" class="search_result_row ds_collapse_flag "
   data-search-page="1" data-gpnav="item">
    <div class="search_capsule"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632360/capsule_231x87.jpg" ></div>
    <div class="responsive_search_name_combined">
      <div class="search_name ellipsis"><span class="title">Risk of Rain 2</span></div>
      <div class="search_reviewscore responsive_secondrow">
        <span class="search_review_summary positive" data-tooltip-html="дуже схвальні&lt;br&gt;93% з 1&nbsp;893 рецензій на цю гру є позитивними."></span>
      </div>
      <div class="search_price_discount_combined responsive_secondrow" data-price-final="10800">
        <div class="discount_block search_discount_block" data-price-final="10800" data-bundlediscount="0" data-discount="67"><div class="discount_pct">-67%</div><div class="discount_prices"><div class="discount_original_price">329,00₴</div><div class="discount_final_price">108,00₴</div></div></div>
      </div>
    </div>
  </a>
  <a href="https://store.steampowered.com/bundle/1234/Some_Bundle/"
   data-ds-bundleid="1234" data-ds-packageid="55" class="search_result_row ds_collapse_flag ">
    <span class="title">Набір із трьох ігор</span>
    <div class="discount_block" data-price-final="50000" data-discount="40"></div>
  </a>
  <a href="https://store.steampowered.com/app/1174180/Red_Dead_Redemption_2/"
   data-ds-appid="1174180" class="search_result_row ds_collapse_flag ">
    <span class="title">Tom Clancy&#39;s &amp; Red Dead Redemption 2</span>
    <div class="search_price_discount_combined" data-price-final="64900">
      <div class="discount_block" data-price-final="64900" data-discount="75"><div class="discount_original_price">2 599,00₴</div></div>
    </div>
  </a>
  <a href="https://store.steampowered.com/app/10/Without_Discount/" data-ds-appid="10" class="search_result_row">
    <span class="title">Без знижки</span>
    <div class="discount_block" data-price-final="19900" data-discount="0"></div>
  </a>`;

test('Steam: розбір HTML сторінки знижок (парсинг)', () => {
  const deals = parseSteamSpecials(STEAM_SPECIALS_HTML);
  assert.equal(deals.length, 2, 'набір і гру без знижки пропущено');
  assert.deepEqual(deals[0], {
    store: 'steam',
    storeId: '632360',
    title: 'Risk of Rain 2',
    url: 'https://store.steampowered.com/app/632360/',
    imageUrl: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632360/header.jpg',
    imageFallback: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632360/capsule_231x87.jpg',
    currency: 'UAH',
    price: 10800,
    basePrice: 32900,
    discount: 67,
    rating: 93,
    reviews: 1893,
  });
  assert.equal(deals[1].title, "Tom Clancy's & Red Dead Redemption 2", 'HTML-сутності розкодовано');
  assert.equal(deals[1].basePrice, 259900, 'ціна з пробілом у тисячах');
  assert.equal(deals[1].rating, null, 'без відгуків — без рейтингу');
  assert.deepEqual(parseSteamSpecials(''), []);
});

test('GOG: каталог знижок переводиться у знижки з рейтингом', () => {
  const deals = parseGogDeals({
    products: [
      {
        id: '1207658787',
        title: 'Heroes of Might and Magic® 3: Complete',
        slug: 'heroes_of_might_and_magic_3_complete_edition',
        coverHorizontal: 'https://images.gog-statics.com/a18a.png',
        price: { finalMoney: { amount: '3.35', currency: 'USD' }, baseMoney: { amount: '6.71', currency: 'USD' } },
        reviewsRating: 48,
        reviewsCount: 15929,
      },
      { id: '2', title: 'Без знижки', price: { finalMoney: { amount: '9.99', currency: 'USD' }, baseMoney: { amount: '9.99' } } },
      { id: '3', title: 'Без ціни', price: null },
    ],
  });
  assert.equal(deals.length, 1);
  assert.equal(deals[0].price, 335);
  assert.equal(deals[0].basePrice, 671);
  assert.equal(deals[0].discount, 50);
  assert.equal(deals[0].rating, 96, 'рейтинг GOG 4,8 з 5 → 96%');
  assert.equal(deals[0].url, 'https://www.gog.com/en/game/heroes_of_might_and_magic_3_complete_edition');
});
