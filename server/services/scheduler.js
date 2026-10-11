// Автоматичні задачі за розкладом: перевірка цін, роздачі Epic, курс долара, очищення сесій.
// Час останнього запуску зберігається в базі, тому після перезапуску сервера
// задачі не виконуються зайвий раз.
import { getSetting, setSetting } from '../db.js';
import { log } from '../logger.js';

const jobs = new Map();
let timer = null;
let firstTimer = null;

export function defineJob(name, { title, everyMinutes, run }) {
  jobs.set(name, { name, title, everyMinutes, run, running: false, lastResult: null, lastError: null });
}

export async function runJob(name, trigger = 'schedule') {
  const job = jobs.get(name);
  if (!job) throw new Error(`Невідома задача: ${name}`);
  if (job.running) return { skipped: true, reason: 'вже виконується' };
  job.running = true;
  setSetting(`job:${name}:last_run`, new Date().toISOString());
  try {
    job.lastResult = await job.run({ trigger });
    job.lastError = null;
    return job.lastResult;
  } catch (err) {
    job.lastError = err.message;
    log.error(`job.${name}`, `Задача «${job.title}» завершилась з помилкою: ${err.message}`);
    throw err;
  } finally {
    job.running = false;
  }
}

function isDue(job) {
  const last = getSetting(`job:${job.name}:last_run`);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() >= job.everyMinutes * 60 * 1000;
}

// Задачі виконуються по черзі в тому порядку, в якому їх оголошено
async function tick() {
  for (const job of jobs.values()) {
    if (!job.running && isDue(job)) {
      await runJob(job.name).catch(() => {}); // помилка вже записана в журнал
    }
  }
}

export function startScheduler({ firstTickMs = 5000 } = {}) {
  firstTimer = setTimeout(tick, firstTickMs);
  timer = setInterval(tick, 60 * 1000);
  log.info('scheduler.started', `Розклад запущено: ${[...jobs.values()].map((j) => `${j.title} кожні ${j.everyMinutes} хв`).join('; ')}`);
}

export function stopScheduler() {
  clearTimeout(firstTimer);
  clearInterval(timer);
  timer = null;
}

export function jobsStatus() {
  return [...jobs.values()].map((j) => {
    const last = getSetting(`job:${j.name}:last_run`);
    return {
      name: j.name,
      title: j.title,
      everyMinutes: j.everyMinutes,
      running: j.running,
      lastRun: last,
      nextRun: last ? new Date(new Date(last).getTime() + j.everyMinutes * 60000).toISOString() : null,
      lastResult: j.lastResult,
      lastError: j.lastError,
    };
  });
}
