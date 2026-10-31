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
  // На сервері сайт слухає лише 127.0.0.1, а назовні його відкриває HTTPS-проксі (Caddy)
  host: env.HOST || undefined,
  // За проксі справжній IP відвідувача приходить у заголовку X-Forwarded-For
  trustProxy: env.TRUST_PROXY === '1',
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

  // Пуш-сповіщення: ключі VAPID створюються самі й лежать у базі. testOrigin — тестовий «сервіс сповіщень» в автотестах.
  push: {
    testOrigin: (env.PUSH_TEST_ORIGIN || '').replace(/\/$/, ''),
  },

  schedule: {
    pricesMinutes: num(env.CHECK_INTERVAL_MINUTES, 180),
    epicMinutes: num(env.EPIC_INTERVAL_MINUTES, 360),
    dealsMinutes: num(env.DEALS_INTERVAL_MINUTES, 60),
    rateMinutes: num(env.RATE_INTERVAL_MINUTES, 720),
    steamSyncMinutes: num(env.STEAM_SYNC_INTERVAL_MINUTES, 360),
  },

  // Звідки брати вітрину: live — справжні знижки (і в демо-режимі), demo — тестові без інтернету
  dealsSource: env.DEALS_SOURCE === 'demo' ? 'demo' : 'live',

  sessionDays: num(env.SESSION_DAYS, 30),

  // Адреси Steam для списку бажаного (в автотестах підміняються тестовим сервером)
  steam: {
    apiBase: (env.STEAM_API_URL || 'https://api.steampowered.com').replace(/\/$/, ''),
    communityBase: (env.STEAM_COMMUNITY_URL || 'https://steamcommunity.com').replace(/\/$/, ''),
  },

  // Листи: Brevo (BREVO_API_KEY + MAIL_FROM — підтверджена в Brevo адреса) або Resend (RESEND_API_KEY).
  // Без ключів листи складаються в тестову скриньку, яку видно в адмін-панелі.
  mail: {
    brevoKey: (env.BREVO_API_KEY || '').trim(),
    resendKey: (env.RESEND_API_KEY || '').trim(),
    from: (env.MAIL_FROM || '').trim(),
    fromName: (env.MAIL_FROM_NAME || 'Знижколов').trim(),
  },

  // Вхід через Google (OAuth 2.0): ключі з Google Cloud Console. Без них кнопки «Увійти через Google» немає.
  // Адреси Google можна підмінити — так тести працюють без справжнього Google.
  google: {
    clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    userinfoUrl: env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
  },

  // ШІ-порадник: Groq (швидкий, безкоштовний ключ з console.groq.com) і запасний Google Gemini
  // (безкоштовний ключ з aistudio.google.com). Потрібен хоча б один ключ, інакше порадника немає.
  // У кожного дві моделі: розумна для поради «купувати чи чекати», легка для розмови.
  ai: {
    groq: {
      key: (env.GROQ_API_KEY || '').trim(),
      apiUrl: (env.GROQ_API_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
      smartModel: env.GROQ_SMART_MODEL || 'openai/gpt-oss-120b',
      lightModel: env.GROQ_LIGHT_MODEL || 'openai/gpt-oss-20b',
    },
    gemini: {
      key: (env.GEMINI_API_KEY || '').trim(),
      apiUrl: (env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
      smartModel: env.GEMINI_SMART_MODEL || 'gemini-3.5-flash',
      lightModel: env.GEMINI_LIGHT_MODEL || 'gemini-3.5-flash-lite',
    },
    // Скільки чекати одну відповідь моделі, перш ніж перейти до запасної
    timeoutMs: num(env.AI_TIMEOUT_MS, 15000),
    retryMs: num(env.AI_RETRY_MS, 1500),
  },
};

export const isHttps = config.baseUrl.startsWith('https://');
