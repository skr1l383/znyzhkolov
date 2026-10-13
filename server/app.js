// Збирає застосунок: база даних, маршрути API, задачі за розкладом.
import http from 'node:http';
import { config } from './config.js';
import { initDb } from './db.js';
import { createApp, Router } from './http.js';
import { initLogger, log } from './logger.js';
import { SESSION_COOKIE, cleanupSessions, userBySession } from './auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { dealRoutes } from './routes/deals.js';
import { gameRoutes } from './routes/games.js';
import { profileRoutes } from './routes/profile.js';
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
  initDb(dbFile);
  initLogger({ silent });
  repairImages();
  defineJobs();

  const router = new Router();
  authRoutes(router);
  gameRoutes(router);
  dealRoutes(router);
  profileRoutes(router);
  adminRoutes(router);

  const handler = createApp({
    router,
    publicDir: config.publicDir,
    beforeRoute: (ctx) => {
      ctx.user = userBySession(ctx.cookies[SESSION_COOKIE]);
    },
    onError: (err, ctx) => {
      log.error('http.error', `${ctx.method} ${ctx.path}: ${err.message}`, {
        userId: ctx.user?.id ?? null,
        meta: { stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') },
      });
    },
  });

  return http.createServer(handler);
}
