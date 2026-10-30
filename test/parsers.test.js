// Перевірка розбору відповідей магазинів. Структура тестових даних
// повторює справжні відповіді Steam, GOG, Epic Games і НБУ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamPrices, parseSteamSearch } from '../server/stores/steam.js';
import { parseGogCatalog } from '../server/stores/gog.js';
import { parseEpicFreebies } from '../server/stores/epic.js';
import { bestKeyPrice, parseKeyGame } from '../server/stores/keys.js';
import { genresFromGog, parseSteamExtras, uniqueCompanies } from '../server/stores/genres.js';
import { parseNbuRate, parseNbuRates, toUahAny } from '../server/stores/currency.js';
import { parsePriceOverview, REGIONS } from '../server/stores/regional.js';
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

test('НБУ: курси всіх валют і перерахунок у гривні', () => {
  const rates = parseNbuRates([
    { r030: 840, cc: 'USD', rate: 45.2021 },
    { r030: 978, cc: 'EUR', rate: 50.5766 },
    { r030: 392, cc: 'JPY', rate: 0.28812 },
    { r030: 959, cc: 'XAU', rate: 0 }, // золото без курсу — пропускаємо
    { txt: 'зіпсований рядок' },
  ]);
  assert.deepEqual(rates, { USD: 45.2021, EUR: 50.5766, JPY: 0.28812 });
  assert.equal(toUahAny(1479, 'EUR', rates), 74803, '14,79 € ≈ 748,03 ₴');
  assert.equal(toUahAny(170000, 'JPY', rates), 48980, 'Steam віддає єни теж у сотих: ¥1700 ≈ 489,80 ₴');
  assert.equal(toUahAny(32500, 'UAH', rates), 32500);
  assert.equal(toUahAny(4699, 'BRL', rates), null, 'курсу реала НБУ не публікує');
  assert.deepEqual(parseNbuRates(null), {});
});

test('Steam: ціна в окремій країні (карта цін)', () => {
  const ok = { 367520: { success: true, data: { price_overview: { currency: 'PLN', initial: 6799, final: 3399, discount_percent: 50 } } } };
  assert.deepEqual(parsePriceOverview(ok, '367520'), { currency: 'PLN', price: 3399, basePrice: 6799, discount: 50 });
  assert.equal(parsePriceOverview({ 570: { success: true, data: [] } }, '570'), null, 'безкоштовна гра — ціни немає');
  assert.equal(parsePriceOverview({ 1: { success: false } }, '1'), null, 'не продається в цій країні');
  assert.equal(parsePriceOverview(null, '1'), null);
  // Україна — перший регіон; євро в Steam беруть і країни ЄС без власної валюти
  assert.equal(REGIONS[0].id, 'UA');
  const eu = REGIONS.find((r) => r.id === 'EU');
  assert.equal(eu.cc, 'DE');
  assert.ok(['FR', 'ES', 'CZ', 'SE'].every((c) => eu.countries.includes(c)));
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

test('GOG: важкі PNG-обкладинки замінюються стиснутими', async () => {
  const { gogImage } = await import('../server/stores/gog.js');
  const hash = 'c75e674590b8947542c809924df30bbef2190341163dd08668e243c266be70c5';
  const small = `https://images.gog-statics.com/${hash}_product_tile_398_2x.jpg`;
  assert.equal(gogImage(`https://images.gog-statics.com/${hash}.png`), small);
  assert.equal(gogImage(`https://images.gog-statics.com/${hash}_glx_logo.jpg`), small);
  const steam = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/570/header.jpg';
  assert.equal(gogImage(steam), steam, 'картинки інших магазинів не змінюються');
  assert.equal(gogImage('https://example.com/a.png'), null, 'картинки з невідомих сайтів не показуємо');
  assert.equal(gogImage('javascript:alert(1)'), null);
});

test('Сторінка гри: HTML-опис магазину перетворюється на безпечний текст', async () => {
  const { htmlToParagraphs } = await import('../server/stores/details.js');
  const html = `<h2 class="bb_tag">Про гру</h2><p>Перший&nbsp;абзац &amp; ще трохи.</p><br><script>alert(1)</script>
    <ul class="bb_ul"><li>Пункт один</li><li><b>Пункт</b> два</li></ul><img src="x" onerror="alert(2)">Кінець`;
  assert.deepEqual(htmlToParagraphs(html), ['Про гру', 'Перший абзац & ще трохи.', '• Пункт один', '• Пункт два', 'Кінець']);
  assert.deepEqual(htmlToParagraphs(''), []);
});

test('Сторінка гри: дані Steam і GOG', async () => {
  const { parseSteamDetails, parseSteamReviews, parseGogProduct } = await import('../server/stores/details.js');
  const steam = parseSteamDetails(
    {
      1145360: {
        success: true,
        data: {
          name: 'Hades',
          short_description: 'Defy the god of the dead &amp; more',
          about_the_game: '<img src="a.gif">',
          detailed_description: '<p>Повний опис</p>',
          header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg',
          screenshots: [{ path_thumbnail: 'https://shared.akamai.steamstatic.com/ss.600x338.jpg', path_full: 'https://shared.akamai.steamstatic.com/ss.1920x1080.jpg' }],
          movies: [{ name: 'Trailer', thumbnail: 'https://shared.akamai.steamstatic.com/m.jpg', hls_h264: 'https://video.akamai.steamstatic.com/t/hls_264_master.m3u8' }, { name: 'Без HLS' }],
          genres: [{ description: 'Інді' }],
          developers: ['Supergiant Games'],
          release_date: { date: '17 верес. 2020', coming_soon: false },
          metacritic: { score: 93 },
          platforms: { windows: true, mac: true, linux: false },
          price_overview: { currency: 'UAH', initial: 51500, final: 41200, discount_percent: 20 },
        },
      },
    },
    '1145360'
  );
  assert.equal(steam.title, 'Hades');
  assert.equal(steam.shortDescription, 'Defy the god of the dead & more');
  assert.deepEqual(steam.description, ['Повний опис'], 'якщо «про гру» — лише картинки, береться повний опис');
  assert.equal(steam.videos.length, 1, 'трейлер без потоку HLS пропущено');
  assert.deepEqual(steam.platforms, ['windows', 'mac']);
  assert.deepEqual(steam.price, { currency: 'UAH', price: 41200, basePrice: 51500, discount: 20 });
  assert.equal(parseSteamDetails({ 1: { success: false } }, '1'), null);
  assert.deepEqual(parseSteamReviews({ query_summary: { total_positive: 98, total_reviews: 100, review_score_desc: 'Very Positive' } }), {
    percent: 98,
    total: 100,
    summary: 'Very Positive',
  });

  const gog = parseGogProduct({
    id: 1308320804,
    title: 'Hollow Knight',
    links: { product_card: 'https://www.gog.com/game/hollow_knight' },
    images: { background: '//images-1.gog-statics.com/bg.jpg' },
    description: { full: '<p>Опис GOG</p>' },
    screenshots: [{ formatter_template_url: 'https://images-1.gog-statics.com/abc_{formatter}.png' }],
    videos: [
      { video_url: 'https://www.youtube.com/embed/jFwdbtqsM8c?wmode=opaque&rel=0', thumbnail_url: 'https://img.youtube.com/vi/jFwdbtqsM8c/hqdefault.jpg', provider: 'youtube' },
      { video_url: 'https://fast.wistia.net/embed/iframe/72q7bnpifp', provider: 'wistia' },
    ],
  });
  assert.equal(gog.background, 'https://images-1.gog-statics.com/bg.jpg');
  assert.equal(gog.screenshots[0].full, 'https://images-1.gog-statics.com/abc_ggvgm_2x.jpg');
  assert.deepEqual(gog.videos.map((v) => v.src), ['https://www.youtube-nocookie.com/embed/jFwdbtqsM8c'], 'YouTube без стеження, інші сервіси пропущено');
});

test('CheapShark: лише офіційні продавці ключів, від найдешевшого', () => {
  const json = {
    info: { title: 'Hollow Knight', steamAppID: '367520', thumb: 'https://shared.fastly.steamstatic.com/a.jpg' },
    cheapestPriceEver: { price: '2.99', date: 1712840581 },
    deals: [
      { storeID: '1', dealID: 'steam%3D', price: '7.49', retailPrice: '14.99', savings: '50' }, // Steam — беремо напряму
      { storeID: '25', dealID: 'epic', price: '5.00', retailPrice: '14.99', savings: '66' }, // Epic — ціни США оманливі
      { storeID: '3', dealID: 'gmg%2B1', price: '8.99', retailPrice: '14.99', savings: '40' },
      { storeID: '15', dealID: 'fan', price: '6.74', retailPrice: '14.99', savings: '55' },
      { storeID: '11', dealID: 'bad', price: '', retailPrice: '14.99' },
    ],
  };
  const parsed = parseKeyGame(json);
  assert.deepEqual(parsed.deals.map((d) => d.seller), ['Fanatical', 'Green Man Gaming']);
  assert.equal(parsed.deals[0].price, 674);
  assert.equal(parsed.deals[0].discount, 55);
  assert.equal(parsed.deals[1].url, 'https://www.cheapshark.com/redirect?dealID=gmg%2B1', 'dealID не кодується вдруге');
  assert.deepEqual(parsed.lowestEver, { price: 299, currency: 'USD', at: '2024-04-11T13:03:01.000Z' });
  assert.equal(bestKeyPrice(parsed).seller, 'Fanatical');
  assert.deepEqual(bestKeyPrice(parseKeyGame({ deals: [] })), { available: false });
  assert.deepEqual(parseKeyGame(null).deals, []);
});

test('Жанри: теги Steam і жанри GOG зводяться до одного списку, студії без повторів', () => {
  const steam = parseSteamExtras({
    response: {
      store_items: [
        {
          appid: 367520,
          tagids: [1628, 1625, 19, 492, 4026],
          basic_info: { developers: [{ name: 'Team Cherry' }], publishers: [{ name: 'Team Cherry' }] },
        },
        {
          appid: 10,
          tags: [{ tagid: 1663 }, { tagid: 1667 }],
          assets: { asset_url_format: 'steam/apps/10/${FILENAME}?t=1', header: 'ab12/header_alt.jpg', library_hero: 'cd34/library_hero.jpg', main_capsule: 'cd34/capsule_616x353.jpg' },
        },
      ],
    },
  });
  // Точні адреси картинок: у нових ігор вони в папці з хешем
  assert.equal(steam.get('10').imageUrl, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/ab12/header_alt.jpg?t=1');
  assert.equal(steam.get('10').heroUrl, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/cd34/library_hero.jpg?t=1');
  assert.equal(steam.get('10').heroSmallUrl, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/cd34/capsule_616x353.jpg?t=1');
  assert.deepEqual(steam.get('367520'), { genres: ['action', 'platformer', 'indie'], companies: ['Team Cherry'] });
  assert.deepEqual(steam.get('10').genres, ['shooter', 'horror'], 'FPS — це шутер');
  assert.deepEqual(genresFromGog({ genres: [{ slug: 'role-playing' }], tags: [{ slug: 'open-world' }, { slug: 'fantasy' }] }), ['rpg', 'openworld']);
  assert.deepEqual(genresFromGog({}), []);
  assert.deepEqual(uniqueCompanies(['CAPCOM Co., Ltd.', 'Valve'], ['Capcom', 'Bethesda Softworks LLC', 'Valve Corporation']), ['CAPCOM', 'Valve', 'Bethesda Softworks']);
});
