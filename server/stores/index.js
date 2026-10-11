// Єдина точка доступу до магазинів. У демо-режимі підставляються тестові дані.
import { config } from '../config.js';
import { demoEpicFreebies, demoStores, demoUsdRate } from './demo.js';
import { fetchEpicFreebies } from './epic.js';
import { fetchGogPrices, searchGog } from './gog.js';
import { fetchSteamPrices, searchSteam } from './steam.js';
import { fetchUsdRate } from './currency.js';

export const STORE_NAMES = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games' };

/** Магазини, у яких можна шукати ігри та стежити за цінами. */
export const SEARCHABLE = ['steam', 'gog'];

const real = {
  steam: {
    search: searchSteam,
    // приймає масив пропозицій, віддає Map storeId → ціна
    fetchPrices: (offers) => fetchSteamPrices(offers.map((o) => o.storeId)),
  },
  gog: {
    search: searchGog,
    fetchPrices: (offers) => fetchGogPrices(offers),
  },
};

const demo = {
  steam: {
    search: demoStores.steam.search,
    fetchPrices: (offers) => demoStores.steam.fetchPrices(offers.map((o) => o.storeId)),
  },
  gog: {
    search: demoStores.gog.search,
    fetchPrices: (offers) => demoStores.gog.fetchPrices(offers),
  },
};

export function store(name) {
  const s = (config.demoStores ? demo : real)[name];
  if (!s) throw new Error(`Невідомий магазин: ${name}`);
  return s;
}

export const getEpicFreebies = () => (config.demoStores ? demoEpicFreebies() : fetchEpicFreebies());
export const fetchLatestUsdRate = () => (config.demoStores ? demoUsdRate() : fetchUsdRate());
