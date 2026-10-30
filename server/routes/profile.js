import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, getSetting, nameKey, now } from '../db.js';
import { detectImage } from '../formats/detect.js';
import { HttpError, readUpload, sendFile } from '../http.js';
import { tr, userLang } from '../i18n.js';
import { log } from '../logger.js';
import { publicUser, requireAuth } from '../auth.js';
import { freebieStats, listFreebies, listPastFreebies } from '../services/epicFree.js';
import { notifyUser } from '../services/notifier.js';
import { runJob } from '../services/scheduler.js';
import { listWatch, summarizeWatch } from '../services/watch.js';
import { botStatus, ensureBotUsername, linkUrl } from '../services/telegram.js';
import * as v from '../validate.js';

const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_DIR = path.join(config.dataDir, 'avatars');

function removeAvatarFile(fileName) {
  if (!fileName) return;
  fs.rm(path.join(AVATAR_DIR, path.basename(fileName)), { force: true }, () => {});
}

export function profileRoutes(router) {
  // Підсумок для шапки профілю: скільки ігор, скільки умов виконано, сповіщень і скільки можна заощадити
  router.get('/api/me/summary', requireAuth, (ctx) => {
    const items = listWatch(ctx.user.id);
    const s = summarizeWatch(items);
    const count = (sql) => db.prepare(sql).get(ctx.user.id).n;
    return {
      games: items.length,
      met: s.met,
      alerts: count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?'),
      unread: count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL'),
      savingsUah: s.savings,
      // Обкладинки ігор зі списку — для фону шапки профілю
      covers: items.map((i) => i.imageUrl).filter(Boolean).slice(0, 6),
    };
  });

  router.patch('/api/me', requireAuth, (ctx) => {
    const changes = {};
    if ('name' in ctx.body) {
      changes.name = v.nickname(ctx.body.name);
      changes.name_key = nameKey(changes.name);
      const taken = db.prepare('SELECT 1 FROM users WHERE name_key = ? AND id != ?').get(changes.name_key, ctx.user.id);
      if (taken) throw new HttpError(409, 'Цей нік уже зайнятий. Вигадай інший', { field: 'name' });
    }
    if ('notifyEpicFree' in ctx.body) changes.notify_epic_free = ctx.body.notifyEpicFree ? 1 : 0;
    if ('notifyEmail' in ctx.body) changes.notify_email = ctx.body.notifyEmail ? 1 : 0;
    if ('lang' in ctx.body) {
      if (!['uk', 'en'].includes(ctx.body.lang)) throw new HttpError(400, 'Непідтримувана мова');
      changes.lang = ctx.body.lang;
    }
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

  // Аватар: файл лежить у data/avatars, у базі — лише його ім'я
  router.upload('/api/me/avatar', requireAuth, async (ctx) => {
    const { buffer, name } = await readUpload(ctx.req, { maxBytes: AVATAR_MAX_BYTES });
    const image = detectImage(buffer);
    if (!image) {
      log.warn('profile.avatar.rejected', `${ctx.user.email}: файл «${name}» не є картинкою PNG, JPG або WEBP`, { userId: ctx.user.id });
      throw new HttpError(415, 'Формат не підтримується. Можна завантажити картинку PNG, JPG або WEBP');
    }
    // Нове випадкове ім'я при кожному завантаженні: браузер не покаже старе фото з кешу
    const fileName = `${ctx.user.id}-${crypto.randomBytes(8).toString('hex')}.${image.ext}`;
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    fs.writeFileSync(path.join(AVATAR_DIR, fileName), buffer);
    removeAvatarFile(userById(ctx.user.id).avatar);
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(fileName, ctx.user.id);
    log.info('profile.avatar', `${ctx.user.email} змінив фото профілю (${Math.round(buffer.length / 1024)} КБ)`, { userId: ctx.user.id });
    return { user: publicUser(userById(ctx.user.id)) };
  });

  router.delete('/api/me/avatar', requireAuth, (ctx) => {
    removeAvatarFile(userById(ctx.user.id).avatar);
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(ctx.user.id);
    log.info('profile.avatar', `${ctx.user.email} видалив фото профілю`, { userId: ctx.user.id });
    return { user: publicUser(userById(ctx.user.id)) };
  });

  router.get('/api/avatars/:file', requireAuth, (ctx) => {
    const m = /^\d+-[0-9a-f]{16}\.(png|jpg|webp)$/.exec(ctx.params.file);
    if (!m) throw new HttpError(404, 'Фото не знайдено');
    let buffer;
    try {
      buffer = fs.readFileSync(path.join(AVATAR_DIR, ctx.params.file));
    } catch {
      throw new HttpError(404, 'Фото не знайдено');
    }
    const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[m[1]];
    sendFile(ctx.res, buffer, { type, cache: 'private, max-age=86400' });
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
    const lang = userLang(user);
    const title = tr(lang, 'Тестове сповіщення');
    const body = tr(lang, 'Якщо ти це бачиш, усе налаштовано правильно.');
    const result = await notifyUser(user, { kind: 'system', title, body, html: `✅ <b>${title}</b>\n${body}` });
    if (!result.telegram) throw new HttpError(502, 'Не вдалося надіслати повідомлення в Telegram. Перевірте, чи не заблоковано бота');
    return { ok: true };
  });

  router.get('/api/notifications', requireAuth, (ctx) => {
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const items = db
      // Обкладинка — збережена разом зі сповіщенням або гри зі списку; game — сторінка гри на сайті (Steam, якщо є)
      .prepare(
        `SELECT n.*, COALESCE(n.image_url, g.image_url) AS cover,
           (SELECT o.store || ':' || o.store_id FROM offers o WHERE o.game_id = n.game_id AND o.store IN ('steam', 'gog')
            ORDER BY o.store = 'steam' DESC LIMIT 1) AS page
         FROM notifications n LEFT JOIN games g ON g.id = n.game_id
         WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ?`
      )
      .all(ctx.user.id, limit)
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        url: n.url,
        imageUrl: n.cover || null,
        game: n.page ? { store: n.page.split(':')[0], storeId: n.page.split(':')[1] } : null,
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
    return { items: listFreebies(), past: listPastFreebies(), stats: freebieStats(), lastCheck: getSetting('job:epic:last_run') };
  });
}
