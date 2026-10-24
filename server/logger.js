// Логування подій одночасно в базу даних (таблиця event_log, її видно в адмін-панелі)
// і у файл logs/app.log (по одному JSON-рядку на подію).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, isDbOpen, now } from './db.js';

let logFile = null;
let quiet = false;

export function initLogger({ silent = false } = {}) {
  quiet = silent;
  fs.mkdirSync(config.logDir, { recursive: true });
  logFile = path.join(config.logDir, 'app.log');
}

function write(level, type, message, { userId = null, meta = null } = {}) {
  const createdAt = now();
  const metaJson = meta ? JSON.stringify(meta) : null;

  // Якщо база недоступна, подія все одно потрапить у файл і консоль
  if (isDbOpen()) {
    try {
      db.prepare(
        'INSERT INTO event_log (level, type, message, user_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(level, type, message, userId, metaJson, createdAt);
    } catch (err) {
      if (!quiet) console.error('[log] не вдалося записати подію в БД:', err.message);
    }
  }

  if (logFile) {
    const line = JSON.stringify({ time: createdAt, level, type, message, userId, meta }) + '\n';
    fs.appendFile(logFile, line, () => {});
  }

  if (!quiet) {
    const stamp = createdAt.slice(11, 19);
    const out = level === 'error' ? console.error : console.log;
    out(`${stamp} ${level.toUpperCase().padEnd(5)} ${type}: ${message}`);
  }
}

export const log = {
  info: (type, message, extra) => write('info', type, message, extra),
  warn: (type, message, extra) => write('warn', type, message, extra),
  error: (type, message, extra) => write('error', type, message, extra),
};
