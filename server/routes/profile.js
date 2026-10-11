import crypto from 'node:crypto';
import { db, getSetting, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { publicUser, requireAuth } from '../auth.js';
import { listFreebies } from '../services/epicFree.js';
import { notifyUser } from '../services/notifier.js';
import { runJob } from '../services/scheduler.js';
import { botStatus, ensureBotUsername, linkUrl } from '../services/telegram.js';
import * as v from '../validate.js';

const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export function profileRoutes(router) {
  router.patch('/api/me', requireAuth, (ctx) => {
    const changes = {};
    if ('name' in ctx.body) changes.name = v.text(ctx.body.name, { field: 'name', label: "Ім'я", min: 2, max: 40 });
    if ('notifyEpicFree' in ctx.body) changes.notify_epic_free = ctx.body.notifyEpicFree ? 1 : 0;
    const fields = Object.keys(changes);
    if (fields.length) {
      db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
        ...fields.map((f) => changes[f]),
        ctx.user.id
      );
      log.info('profile.update', `${ctx.user.email} оновив профіль`, { userId: ctx.user.id, meta: changes });
    }
    return { user: publicUser(userById(ctx.user.id)) };
  });

  router.post('/api/me/telegram/link', requireAuth, async (ctx) => {
    const bot = botStatus();
    if (!bot.enabled) {
      throw new HttpError(503, 'Telegram-бот не налаштований. Адміністратор має вказати TELEGRAM_BOT_TOKEN у файлі .env');
    }
    const code = crypto.randomBytes(8).toString('hex');
    db.prepare('UPDATE users SET telegram_link_code = ? WHERE id = ?').run(code, ctx.user.id);
    const username = await ensureBotUsername();
    return { code, url: linkUrl(code), botUsername: username };
  });

  router.post('/api/me/telegram/unlink', requireAuth, (ctx) => {
    db.prepare('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_link_code = NULL WHERE id = ?').run(
      ctx.user.id
    );
    log.info('telegram.unlinked', `${ctx.user.email} відключив Telegram`, { userId: ctx.user.id });
    return { user: publicUser(userById(ctx.user.id)) };
  });

  router.post('/api/me/telegram/test', requireAuth, async (ctx) => {
    const user = userById(ctx.user.id);
    if (!user.telegram_chat_id) throw new HttpError(400, 'Спочатку підключіть Telegram');
    const result = await notifyUser(user, {
      kind: 'system',
      title: 'Тестове сповіщення',
      body: 'Якщо ви це бачите в Telegram, усе налаштовано правильно.',
      html: '✅ <b>Тестове сповіщення</b>\nЯкщо ти це бачиш, усе налаштовано правильно.',
    });
    if (!result.telegram) throw new HttpError(502, 'Не вдалося надіслати повідомлення в Telegram. Перевірте, чи не заблоковано бота');
    return { ok: true };
  });

  router.get('/api/notifications', requireAuth, (ctx) => {
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const items = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(ctx.user.id, limit)
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        url: n.url,
        telegram: Boolean(n.sent_telegram),
        read: Boolean(n.read_at),
        createdAt: n.created_at,
      }));
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(ctx.user.id).n;
    return { items, unread };
  });

  router.post('/api/notifications/read', requireAuth, (ctx) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), ctx.user.id);
    return { ok: true };
  });

  router.get('/api/epic', requireAuth, async () => {
    // Якщо роздачі ще жодного разу не завантажувались, завантажуємо одразу
    if (!getSetting('job:epic:last_run')) {
      try {
        await runJob('epic', 'manual');
      } catch {
        // покажемо те, що є, і помилку в журналі
      }
    }
    return { items: listFreebies(), lastCheck: getSetting('job:epic:last_run') };
  });
}
