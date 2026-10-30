// Збирає застосунок: база даних, маршрути API, задачі за розкладом.
import http from 'node:http';
import { config } from './config.js';
import { initDb, isDbUnavailable } from './db.js';
import { dbAvailable, dbDownError, mapDbError } from './health.js';
import { createApp, Router } from './http.js';
import { initLogger, log } from './logger.js';
import { SESSION_COOKIE, cleanupSessions, userBySession } from './auth.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { advisorRoutes } from './routes/advisor.js';
import { authRoutes } from './routes/auth.js';
import { commentRoutes } from './routes/comments.js';
import { dealRoutes, facetRoutes, featuredRoutes, gamePageRoutes } from './routes/deals.js';
import { gameRoutes } from './routes/games.js';
import { googleRoutes } from './routes/google.js';
import { profileRoutes } from './routes/profile.js';
import { shareRoutes } from './routes/share.js';
import { wishlistRoutes } from './routes/wishlist.js';
import { saveUsdRate } from './stores/currency.js';
import { fetchLatestUsdRate } from './stores/index.js';
import { refreshDeals } from './services/deals.js';
import { runEpicCheck } from './services/epicFree.js';
import { repairImages, runPriceCheck } from './services/prices.js';
import { defineJob } from './services/scheduler.js';

function defineJobs() {
  defineJob('rate', {
    title: 'Курс долара НБУ',
    everyMinutes: config.schedule.rateMinutes,
    run: async () => {
      const rate = await fetchLatestUsdRate();
      saveUsdRate(rate);
      log.info('rate.update', `Курс НБУ: 1 USD = ${rate.rate} грн`);
      return rate;
    },
  });
  defineJob('prices', {
    title: 'Перевірка цін',
    everyMinutes: config.schedule.pricesMinutes,
    run: ({ trigger }) => runPriceCheck({ trigger }),
  });
  defineJob('epic', {
    title: 'Роздачі Epic Games',
    everyMinutes: config.schedule.epicMinutes,
    run: () => runEpicCheck(),
  });
  defineJob('deals', {
    title: 'Вітрина знижок',
    everyMinutes: config.schedule.dealsMinutes,
    run: () => refreshDeals(),
  });
  defineJob('cleanup', {
    title: 'Очищення старих сесій',
    everyMinutes: 24 * 60,
    run: () => ({ removedSessions: cleanupSessions() }),
  });
}

export function buildServer({ dbFile, silent = false } = {}) {
  initLogger({ silent });
  try {
    initDb(dbFile);
  } catch {
    // Сервер однаково запускається: сайт відкривається, API відповідає 503 «база недоступна»,
    // а щойно базу полагодять — запрацює сам (dbAvailable щоразу пробує відкрити її знову)
  }
  if (dbAvailable()) repairImages(); // якщо база не відкрилась, dbAvailable запише це в журнал
  defineJobs();

  const router = new Router();
  // Перевірка для хостингу й моніторингу: 200 — усе гаразд, 503 — база недоступна
  router.get('/api/health', () => ({ ok: true, db: 'ok', uptime: Math.round(process.uptime()) }));
  authRoutes(router);
  googleRoutes(router);
  gameRoutes(router);
  featuredRoutes(router);
  facetRoutes(router);
  dealRoutes(router);
  gamePageRoutes(router);
  commentRoutes(router);
  profileRoutes(router);
  accountRoutes(router);
  shareRoutes(router);
  wishlistRoutes(router);
  adminRoutes(router);
  advisorRoutes(router);

  const handler = createApp({
    router,
    publicDir: config.publicDir,
    beforeRoute: (ctx) => {
      if (!dbAvailable()) throw dbDownError();
      ctx.user = userBySession(ctx.cookies[SESSION_COOKIE]);
    },
    mapError: mapDbError,
    onError: (err, ctx) => {
      log.error(isDbUnavailable(err) ? 'db.error' : 'http.error', `${ctx.method} ${ctx.path}: ${err.message}`, {
        userId: ctx.user?.id ?? null,
        meta: { stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') },
      });
    },
  });

  return http.createServer(handler);
}
