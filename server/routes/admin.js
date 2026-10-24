// Адмін-панель: доступна лише користувачам з роллю admin.
import { db } from '../db.js';
import { HttpError, templateError } from '../http.js';
import { log } from '../logger.js';
import { requireAdmin } from '../auth.js';
import { getUsdRate } from '../stores/currency.js';
import { jobsStatus, runJob } from '../services/scheduler.js';
import { listOutbox, mailProvider } from '../services/mailer.js';
import { botStatus } from '../services/telegram.js';
import * as v from '../validate.js';

const count = (sql, ...args) => db.prepare(sql).get(...args).n;

export function adminRoutes(router) {
  router.get('/api/admin/overview', requireAdmin, () => {
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    return {
      stats: {
        users: count('SELECT COUNT(*) AS n FROM users'),
        watchItems: count('SELECT COUNT(*) AS n FROM watch_items WHERE active = 1'),
        games: count('SELECT COUNT(*) AS n FROM games'),
        offers: count('SELECT COUNT(*) AS n FROM offers'),
        notifications24h: count('SELECT COUNT(*) AS n FROM notifications WHERE created_at > ?', dayAgo),
        errors24h: count("SELECT COUNT(*) AS n FROM event_log WHERE level = 'error' AND created_at > ?", dayAgo),
      },
      jobs: jobsStatus(),
      telegram: botStatus(),
      usdRate: getUsdRate(),
    };
  });

  router.get('/api/admin/users', requireAdmin, () => ({
    users: db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at,
           u.telegram_chat_id IS NOT NULL AS telegram,
           (SELECT COUNT(*) FROM watch_items w WHERE w.user_id = u.id) AS watch_count
         FROM users u ORDER BY u.created_at DESC`
      )
      .all()
      .map((u) => ({ ...u, telegram: Boolean(u.telegram) })),
  }));

  router.patch('/api/admin/users/:id', requireAdmin, (ctx) => {
    const userId = v.id(ctx.params.id);
    const role = ctx.body.role;
    if (!['user', 'admin'].includes(role)) throw new HttpError(400, 'Невідома роль');
    if (userId === ctx.user.id) throw new HttpError(400, 'Не можна змінити роль самому собі');
    const target = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!target) throw new HttpError(404, 'Користувача не знайдено');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    log.info('admin.role', `${ctx.user.email} змінив роль ${target.email} на ${role}`, { userId: ctx.user.id });
    return { ok: true };
  });

  // Тестова поштова скринька: листи, які «надіслав» би сайт, поки не налаштовано поштовий сервіс
  router.get('/api/admin/outbox', requireAdmin, () => ({
    provider: mailProvider(),
    items: listOutbox(30).map((m) => ({
      id: m.id,
      to: m.to_email,
      subject: m.subject,
      kind: m.kind,
      createdAt: m.created_at,
      html: m.html,
      links: [...new Set([...m.text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]))],
    })),
  }));

  router.get('/api/admin/events', requireAdmin, (ctx) => {
    const where = [];
    const args = [];
    if (['info', 'warn', 'error'].includes(ctx.query.level)) {
      where.push('level = ?');
      args.push(ctx.query.level);
    }
    if (ctx.query.type) {
      where.push('type LIKE ?');
      args.push(`${String(ctx.query.type).slice(0, 40)}%`);
    }
    const limit = Math.min(Number(ctx.query.limit) || 100, 500);
    const rows = db
      .prepare(
        `SELECT e.*, u.email FROM event_log e LEFT JOIN users u ON u.id = e.user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.id DESC LIMIT ?`
      )
      .all(...args, limit);
    return { events: rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })) };
  });

  router.post('/api/admin/jobs/:name/run', requireAdmin, async (ctx) => {
    const name = ctx.params.name;
    if (!jobsStatus().some((j) => j.name === name)) throw new HttpError(404, 'Невідома задача');
    log.info('admin.job', `${ctx.user.email} запустив задачу ${name} вручну`, { userId: ctx.user.id });
    try {
      return { result: await runJob(name, 'manual') };
    } catch (err) {
      throw templateError(502, 'Задача завершилась з помилкою: {error}', { error: err.message });
    }
  });
}
