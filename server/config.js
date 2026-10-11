// Налаштування проєкту. Значення беруться з файлу .env (див. .env.example)
// або зі змінних середовища.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env не обов'язковий: без нього працюють значення за замовчуванням
}

const env = process.env;
const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const flag = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const port = num(env.PORT, 3000);

export const config = {
  port,
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  logDir: path.resolve(ROOT, env.LOG_DIR || 'logs'),
  publicDir: path.join(ROOT, 'public'),

  // Демо-режим: замість справжніх магазинів використовуються тестові дані,
  // а ціни випадково змінюються при кожній перевірці (зручно для показу).
  demoStores: flag(env.DEMO_STORES) || process.argv.includes('--demo'),

  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),

  telegram: {
    token: (env.TELEGRAM_BOT_TOKEN || '').trim(),
    apiUrl: (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, ''),
  },

  stores: {
    steamCountry: (env.STEAM_COUNTRY || 'UA').toUpperCase(),
    steamLanguage: env.STEAM_LANGUAGE || 'ukrainian',
    gogCountry: (env.GOG_COUNTRY || 'UA').toUpperCase(),
    epicCountry: (env.EPIC_COUNTRY || 'UA').toUpperCase(),
    usdUahFallback: num(env.USD_UAH_FALLBACK, 45),
  },

  schedule: {
    pricesMinutes: num(env.CHECK_INTERVAL_MINUTES, 180),
    epicMinutes: num(env.EPIC_INTERVAL_MINUTES, 360),
    dealsMinutes: num(env.DEALS_INTERVAL_MINUTES, 60),
    rateMinutes: num(env.RATE_INTERVAL_MINUTES, 720),
  },

  sessionDays: num(env.SESSION_DAYS, 30),
};

export const isHttps = config.baseUrl.startsWith('https://');
