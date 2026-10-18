// Керування акаунтом: зміна пароля й пошти, вивантаження своїх даних, видалення акаунта.
// Усі «небезпечні» дії вимагають поточний пароль — навіть якщо хтось сів за чужий незачинений комп'ютер.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, now, tx } from '../db.js';
import { HttpError, sendFile } from '../http.js';
import { log } from '../logger.js';
import { SESSION_COOKIE, clearSessionCookie, destroyOtherSessions, hashPassword, publicUser, requireAuth, verifyPassword } from '../auth.js';
import { emailLayout, sendMail, siteLink } from '../services/mailer.js';
import { listWatch } from '../services/watch.js';
import * as v from '../validate.js';
import { sendVerificationEmail } from './auth.js';

const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const EMAIL_IN_TEXT = /[^\s«»"'(),:;]+@[^\s«»"'(),:;]+\.[^\s«»"'(),:;]+/g;

async function requirePassword(user, password) {
  if (typeof password !== 'string' || !password) throw v.fieldError('current', 'Введи поточний пароль');
  if (!(await verifyPassword(password, user.password_hash))) {
    log.warn('account.wrong_password', `${user.email}: невірний поточний пароль`, { userId: user.id });
    throw v.fieldError('current', 'Поточний пароль невірний');
  }
}

/** Лист-попередження про важливу зміну в акаунті (щоб власник помітив, якщо це зробив не він). */
function securityNotice(to, user, heading, text) {
  const { html, text: plain } = emailLayout({
    heading,
    paragraphs: [`Привіт, ${user.name}! ${text}`, 'Якщо це зробив не ти — одразу зміни пароль через «Забули пароль?» на сторінці входу.'],
    button: { label: 'Відкрити Знижколов', url: siteLink('#/profile') },
  });
  return sendMail({ to, subject: `Знижколов: ${heading.toLowerCase()}`, html, text: plain, kind: 'security', userId: user.id });
}

export function accountRoutes(router) {
  router.post('/api/me/password', requireAuth, async (ctx) => {
    await requirePassword(ctx.user, ctx.body.current);
    const password = v.password(ctx.body.password);
    if (await verifyPassword(password, ctx.user.password_hash)) throw v.fieldError('password', 'Новий пароль збігається зі старим');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), ctx.user.id);
    destroyOtherSessions(ctx.user.id, ctx.cookies[SESSION_COOKIE]);
    log.info('account.password', `${ctx.user.email} змінив пароль у профілі`, { userId: ctx.user.id });
    if (ctx.user.email_verified_at) await securityNotice(ctx.user.email, ctx.user, 'Пароль змінено', 'Пароль до твого акаунта щойно змінили. На інших пристроях виконано вихід.');
    return { ok: true };
  });

  router.post('/api/me/email', requireAuth, async (ctx) => {
    await requirePassword(ctx.user, ctx.body.current);
    const email = v.email(ctx.body.email);
    if (email === ctx.user.email) throw v.fieldError('email', 'Це і так твоя пошта');
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, ctx.user.id)) {
      throw v.fieldError('email', 'Ця пошта вже зайнята іншим акаунтом');
    }
    const oldEmail = ctx.user.email;
    // Нову пошту треба підтвердити заново; доти листи-сповіщення на неї не йдуть
    db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?').run(email, ctx.user.id);
    const user = userById(ctx.user.id);
    log.info('account.email', `Пошту змінено: ${oldEmail} → ${email}`, { userId: user.id });
    await sendVerificationEmail(user);
    if (ctx.user.email_verified_at) {
      await securityNotice(oldEmail, user, 'Пошту акаунта змінено', `Пошту твого акаунта змінили з ${oldEmail} на ${email}.`);
    }
    return { user: publicUser(user) };
  });

  // Усе, що сайт знає про користувача, одним файлом (право на доступ до своїх даних)
  router.get('/api/me/export.json', requireAuth, (ctx) => {
    const u = userById(ctx.user.id);
    const data = {
      exportedAt: now(),
      profile: {
        name: u.name,
        email: u.email,
        emailVerifiedAt: u.email_verified_at,
        role: u.role,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        telegram: u.telegram_chat_id ? { linked: true, username: u.telegram_username } : { linked: false },
        steamProfileId: u.steam_id,
        settings: { notifyEpicFree: Boolean(u.notify_epic_free), notifyEmail: Boolean(u.notify_email) },
        avatar: Boolean(u.avatar),
        shareLinkEnabled: Boolean(u.share_token),
      },
      watchlist: listWatch(u.id).map((w) => ({
        title: w.title,
        conditions: { minDiscount: w.minDiscount, maxPriceUah: w.maxPriceUah, notifyFree: w.notifyFree, active: w.active },
        addedAt: w.createdAt,
        stores: w.offers.map((o) => ({ store: o.store, id: o.storeId, url: o.url, priceUah: o.priceUah, discount: o.discount })),
      })),
      notifications: db
        .prepare('SELECT kind, title, body, url, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC')
        .all(u.id),
      sessions: db.prepare('SELECT created_at AS createdAt, expires_at AS expiresAt, user_agent AS device FROM sessions WHERE user_id = ?').all(u.id),
    };
    log.info('account.export', `${u.email} завантажив свої дані`, { userId: u.id });
    sendFile(ctx.res, Buffer.from(JSON.stringify(data, null, 2)), {
      type: 'application/json; charset=utf-8',
      filename: `znyzhkolov-moi-dani-${now().slice(0, 10)}.json`,
    });
  });

  // Видалення акаунта: користувач, його список, сповіщення, сесії, фото; у журналі подій — знеособлення
  router.post('/api/me/delete', requireAuth, async (ctx) => {
    await requirePassword(ctx.user, ctx.body.current);
    const u = ctx.user;
    if (u.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 1) {
      throw new HttpError(400, 'Ти єдиний адміністратор. Спершу признач адміністратором когось іншого в адмін-панелі');
    }
    tx(() => {
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // сесії, список, сповіщення, ключі з листів — каскадом
      db.prepare('DELETE FROM outbox WHERE to_email = ?').run(u.email);
      // Журнал безпеки лишається (для статистики й розслідувань), але без особи: у подіях користувача
      // прибираємо всі адреси пошти — і поточну, і ті, що були до зміни пошти
      const anonymize = db.prepare('UPDATE event_log SET user_id = NULL, message = ? WHERE id = ?');
      for (const e of db.prepare('SELECT id, message FROM event_log WHERE user_id = ? OR message LIKE ?').all(u.id, `%${u.email}%`)) {
        anonymize.run(e.message.replace(EMAIL_IN_TEXT, '[видалений користувач]'), e.id);
      }
    });
    if (u.avatar) fs.rm(path.join(config.dataDir, 'avatars', path.basename(u.avatar)), { force: true }, () => {});
    log.info('account.delete', `Акаунт #${u.id} видалено на прохання власника`);
    ctx.setHeaders['Set-Cookie'] = clearSessionCookie();
    return { ok: true };
  });
}
