// Точка входу: npm start (справжні магазини) або npm run demo (тестові дані).
import path from 'node:path';
import { config } from './config.js';
import { buildServer } from './app.js';
import { closeDb } from './db.js';
import { log } from './logger.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { startBot, stopBot } from './services/telegram.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Потрібен Node.js 22.13 або новіший (у вас ${process.versions.node}). Завантажте LTS-версію з https://nodejs.org`);
  process.exit(1);
}

// Демо-режим працює з окремою базою, щоб тестові дані не змішувались зі справжніми
const dbFile = path.join(config.dataDir, config.demoStores ? 'demo.db' : 'znyzhkolov.db');
const server = buildServer({ dbFile });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${config.port} уже зайнятий. Закрийте інший сервер або змініть PORT у файлі .env`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(config.port, () => {
  log.info('server.start', `Знижколов працює: ${config.baseUrl}${config.demoStores ? ' (ДЕМО-режим, тестові ціни)' : ''}`);
  startScheduler();
  startBot();
});

function shutdown(signal) {
  log.info('server.stop', `Зупинка сервера (${signal})`);
  stopScheduler();
  stopBot();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

// Страховка: необроблена помилка у фоновій задачі потрапляє в журнал, а не вимикає весь сервер
process.on('unhandledRejection', (err) => {
  log.error('server.unhandled', `Необроблена помилка: ${err?.message || err}`, {
    meta: { stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | ') },
  });
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
