// Демо-режим (npm run demo): тестові дані замість справжніх магазинів.
// Ціни при кожній перевірці випадково змінюються, тож можна показати,
// як приходять сповіщення, не чекаючи справжнього розпродажу.
import { discountPercent } from './util.js';
import { normalizeTitle } from './match.js';
import { steamHeader } from './deals.js';

const steamImg = (id) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`;

const STEAM = [
  { id: '1145360', title: 'Hades', price: 51500 },
  { id: '1145350', title: 'Hades II', price: 46000 },
  { id: '413150', title: 'Stardew Valley', price: 22900 },
  { id: '367520', title: 'Hollow Knight', price: 27900 },
  { id: '292030', title: 'The Witcher 3: Wild Hunt', price: 99900 },
  { id: '1091500', title: 'Cyberpunk 2077', price: 129900 },
  { id: '632470', title: 'Disco Elysium - The Final Cut', price: 89900 },
  { id: '105600', title: 'Terraria', price: 18900 },
  { id: '504230', title: 'Celeste', price: 37900 },
  { id: '1794680', title: 'Vampire Survivors', price: 9900 },
  { id: '646570', title: 'Slay the Spire', price: 35900 },
  { id: '570', title: 'Dota 2', price: null },
];

const GOG = [
  { id: '1207664663', image: 'https://images.gog-statics.com/536b00d90b91d9248d08aff37920d9706995337cb708cb69fa45e7900edf80b7_product_tile_398_2x.jpg', title: 'The Witcher 3: Wild Hunt - Complete Edition', slug: 'the_witcher_3_wild_hunt_game_of_the_year_edition', price: 3999 },
  { id: '1423049311', image: 'https://images.gog-statics.com/c75e674590b8947542c809924df30bbef2190341163dd08668e243c266be70c5_product_tile_398_2x.jpg', title: 'Cyberpunk 2077', slug: 'cyberpunk_2077', price: 5999 },
  { id: '1453375253', image: 'https://images.gog-statics.com/27d65260098fedca970a717b09a3e2513d8c2a84d02a81ac508b768c011cb46b_product_tile_398_2x.jpg', title: 'Stardew Valley', slug: 'stardew_valley', price: 1499 },
  { id: '1308320804', image: 'https://images.gog-statics.com/e0a2e359588dcfd93af4fdf058f48ca8f77a79ad5c015d9f30bbda6190f1b777_product_tile_398_2x.jpg', title: 'Hollow Knight', slug: 'hollow_knight', price: 1499 },
  { id: '1771589310', image: 'https://images.gog-statics.com/c058d50ddec21689b3cf8d545ec57fba21bccb1505e089e8c7913ada05ce8875_product_tile_398_2x.jpg', title: 'Disco Elysium - The Final Cut', slug: 'disco_elysium', price: 3999 },
  { id: '1207665503', image: 'https://images.gog-statics.com/48c61dc4a3c9fad1f1ff47ab3ea0b1fce365f8d353545c746ea10528522b5df3_product_tile_398_2x.jpg', title: 'Terraria', slug: 'terraria', price: 999 },
];

const DISCOUNTS = [10, 20, 25, 33, 40, 50, 60, 75, 80, 90];

function randomPrice(base) {
  if (base == null) return { price: null, basePrice: null, discount: 0, isFree: false };
  const roll = Math.random();
  if (roll < 0.03) return { price: 0, basePrice: base, discount: 100, isFree: true };
  if (roll < 0.4) {
    const d = DISCOUNTS[Math.floor(Math.random() * DISCOUNTS.length)];
    const price = Math.round((base * (100 - d)) / 100);
    return { price, basePrice: base, discount: discountPercent(base, price), isFree: false };
  }
  return { price: base, basePrice: base, discount: 0, isFree: false };
}

/**
 * Гра не з тестового набору (наприклад, додана зі справжньої вітрини):
 * тестові ціни крутяться навколо її справжньої звичайної ціни.
 */
const baseOf = (o) => o.base_price ?? o.basePrice ?? o.price ?? null;

const matches = (title, term) => normalizeTitle(title).includes(normalizeTitle(term));

const steamOffer = (g, prices = { price: g.price, basePrice: g.price, discount: 0, isFree: false }) => ({
  store: 'steam',
  storeId: g.id,
  title: g.title,
  url: `https://store.steampowered.com/app/${g.id}/`,
  imageUrl: steamImg(g.id),
  currency: g.price == null ? null : 'UAH',
  ...prices,
});

const gogOffer = (g, prices = { price: g.price, basePrice: g.price, discount: 0, isFree: false }) => ({
  store: 'gog',
  storeId: g.id,
  title: g.title,
  url: `https://www.gog.com/en/game/${g.slug}`,
  imageUrl: g.image,
  currency: 'USD',
  ...prices,
});

export const demoStores = {
  steam: {
    search: async (term) => STEAM.filter((g) => matches(g.title, term)).map((g) => steamOffer(g)),
    fetchPrices: async (offers) => {
      const map = new Map();
      for (const o of offers) {
        const g = STEAM.find((x) => x.id === String(o.storeId));
        const base = g ? g.price : baseOf(o);
        map.set(String(o.storeId), { available: true, currency: base == null ? null : 'UAH', ...randomPrice(base) });
      }
      return map;
    },
  },
  gog: {
    search: async (term) => GOG.filter((g) => matches(g.title, term) || matches(term, g.title)).map((g) => gogOffer(g)),
    fetchPrices: async (offers) => {
      const map = new Map();
      for (const o of offers) {
        const g = GOG.find((x) => x.id === String(o.storeId));
        const base = g ? g.price : baseOf(o);
        map.set(String(o.storeId), base == null ? { missing: true } : { available: true, currency: 'USD', ...randomPrice(base) });
      }
      return map;
    },
  },
};

/**
 * Вигадана історія цін за останні `days` днів, щоб у демо-режимі графік не був порожнім.
 * Одна точка на добу (як і в справжньому режимі), раз на 3–6 тижнів — розпродаж на 4–14 днів.
 * Повертає точки від найстарішої до вчорашньої; сьогоднішню ціну запише звичайна перевірка.
 */
export function demoHistory(base, days = 120) {
  if (base == null) return [];
  const day = 864e5;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const points = [];
  let nextSale = 10 + Math.floor(Math.random() * 20);
  let saleLeft = 0;
  let discount = 0;
  for (let i = days; i >= 1; i--) {
    const index = days - i;
    if (saleLeft === 0 && index >= nextSale) {
      discount = DISCOUNTS[2 + Math.floor(Math.random() * 6)]; // від 25% до 75%
      saleLeft = 4 + Math.floor(Math.random() * 11);
      nextSale = index + saleLeft + 21 + Math.floor(Math.random() * 22);
    }
    const d = saleLeft > 0 ? discount : 0;
    if (saleLeft > 0) saleLeft--;
    const price = Math.round((base * (100 - d)) / 100);
    points.push({ price, basePrice: base, discount: d, at: new Date(today.getTime() - i * day).toISOString() });
  }
  return points;
}

/** Вітрина в демо-режимі: ті самі тестові ігри з випадковими знижками. */
export async function demoDeals() {
  const pick = () => DISCOUNTS[1 + Math.floor(Math.random() * (DISCOUNTS.length - 1))];
  const deal = (offer, base) => {
    const discount = pick();
    const price = Math.round((base * (100 - discount)) / 100);
    return { ...offer, price, basePrice: base, discount, rating: 70 + Math.floor(Math.random() * 28), reviews: null };
  };
  return {
    steam: STEAM.filter((g) => g.price).map((g) => deal({ ...steamOffer(g), imageUrl: steamHeader(g.id) }, g.price)),
    gog: GOG.map((g) => deal(gogOffer(g), g.price)),
  };
}

export async function demoEpicFreebies() {
  const day = 864e5;
  const t = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  return [
    { id: 'demo-epic-1', steamId: '2738490', title: 'Sol Cesto', status: 'current', originalPrice: 15000, startsAt: iso(t - 2 * day), endsAt: iso(t + 5 * day) },
    { id: 'demo-epic-2', steamId: '1608640', title: 'OTXO', status: 'current', originalPrice: 27500, startsAt: iso(t - 2 * day), endsAt: iso(t + 5 * day) },
    { id: 'demo-epic-3', steamId: '574980', title: "Them's Fightin' Herds", status: 'upcoming', originalPrice: 27900, startsAt: iso(t + 5 * day), endsAt: iso(t + 12 * day) },
  ].map(({ steamId, ...f }) => ({ ...f, url: 'https://store.epicgames.com/uk/free-games', imageUrl: steamHeader(steamId), currency: 'UAH' }));
}

export const demoUsdRate = async () => ({ rate: 41.45, date: new Date().toLocaleDateString('uk-UA'), rates: demoUsdRates() });

// Курси для демо-режиму (гривень за одиницю валюти), щоб карта цін працювала без інтернету
const DEMO_RATES = {
  USD: 41.45, EUR: 45.1, GBP: 53.9, PLN: 10.4, NOK: 3.9, CHF: 46.8, KZT: 0.083, ILS: 11.2, SAR: 11.05, AED: 11.3, ZAR: 2.3,
  INR: 0.49, CNY: 5.7, JPY: 0.27, KRW: 0.03, IDR: 0.0026, VND: 0.0016, THB: 1.2, AUD: 27.1, NZD: 24.5, CAD: 30.3, MXN: 2.2,
};

// Типові регіональні ціни Steam відносно США: валюта регіону і множник ціни
const DEMO_REGIONS = {
  UA: ['UAH', 0.55], EU: ['EUR', 0.99], US: ['USD', 1], GB: ['GBP', 0.85], PL: ['PLN', 0.8], NO: ['NOK', 1.05], CH: ['CHF', 1.1],
  TR: ['USD', 0.4], KZ: ['KZT', 0.6], IL: ['ILS', 0.9], SA: ['SAR', 0.75], AE: ['AED', 0.8], ZA: ['ZAR', 0.6], IN: ['INR', 0.45],
  CN: ['CNY', 0.5], JP: ['JPY', 0.85], KR: ['KRW', 0.8], ID: ['IDR', 0.5], VN: ['VND', 0.45], TH: ['THB', 0.55], AU: ['AUD', 1.05],
  NZ: ['NZD', 1.05], CA: ['CAD', 0.95], MX: ['MXN', 0.6], AR: ['USD', 0.33],
};

export const demoUsdRates = () => ({ ...DEMO_RATES });

/** Регіональні ціни для демо-режиму: однакові для тієї самої гри, без запитів до Steam. */
export function demoRegionalPrices(appId) {
  const usd = 999 + (Number(appId) % 30) * 100; // ціна в США, центи
  const sale = Number(appId) % 3 === 0 ? 50 : 0;
  return Object.fromEntries(
    Object.entries(DEMO_REGIONS).map(([id, [currency, k]]) => {
      const uah = usd * k * DEMO_RATES.USD;
      const basePrice = currency === 'UAH' ? Math.round(uah / 100) * 100 : Math.round(uah / DEMO_RATES[currency] / 100) * 100 - 1;
      return [id, { currency, price: Math.round((basePrice * (100 - sale)) / 100), basePrice, discount: sale }];
    })
  );
}
