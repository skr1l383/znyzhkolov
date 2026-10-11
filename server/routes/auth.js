import { config } from '../config.js';
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import {
  SESSION_COOKIE,
  checkLoginRate,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  publicUser,
  registerLoginFailure,
  resetLoginFailures,
  sessionCookie,
  verifyPassword,
} from '../auth.js';
import { botStatus } from '../services/telegram.js';
import { getUsdRate } from '../stores/currency.js';
import * as v from '../validate.js';

export function authRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    const name = v.text(ctx.body.name, { field: 'name', label: "Ім'я", min: 2, max: 40 });
    const email = v.email(ctx.body.email);
    const password = v.password(ctx.body.password);

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Користувач з такою поштою вже зареєстрований. Спробуйте увійти', { field: 'email' });
    }

    // Перший зареєстрований користувач (або пошта з ADMIN_EMAIL) стає адміністратором
    const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const role = isFirst || (config.adminEmail && email === config.adminEmail) ? 'admin' : 'user';

    const hash = await hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, name, hash, role, now(), now());
    const userId = Number(info.lastInsertRowid);

    const token = createSession(userId, ctx.req.headers['user-agent']);
    ctx.setHeaders['Set-Cookie'] = sessionCookie(token);
    log.info('auth.register', `Новий користувач ${email} (роль: ${role})`, { userId });
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) };
  });

  router.post('/api/auth/login', async (ctx) => {
    checkLoginRate(ctx.ip);
    const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!email) throw v.fieldError('email', 'Заповніть поле «Електронна пошта»');
    if (!password) throw v.fieldError('password', 'Заповніть поле «Пароль»');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      registerLoginFailure(ctx.ip);
      log.warn('auth.login_failed', `Невдала спроба входу для ${email}`, { userId: user?.id ?? null, meta: { ip: ctx.ip } });
      throw new HttpError(401, 'Невірна пошта або пароль');
    }

    resetLoginFailures(ctx.ip);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    const token = createSession(user.id, ctx.req.headers['user-agent']);
    ctx.setHeaders['Set-Cookie'] = sessionCookie(token);
    log.info('auth.login', `Вхід: ${email}`, { userId: user.id });
    return { user: publicUser(user) };
  });

  router.post('/api/auth/logout', (ctx) => {
    destroySession(ctx.cookies[SESSION_COOKIE]);
    ctx.setHeaders['Set-Cookie'] = clearSessionCookie();
    if (ctx.user) log.info('auth.logout', `Вихід: ${ctx.user.email}`, { userId: ctx.user.id });
    return { ok: true };
  });

  // Хто зараз увійшов + загальні відомості для інтерфейсу
  router.get('/api/me', (ctx) => {
    const bot = botStatus();
    return {
      user: publicUser(ctx.user),
      app: {
        demo: config.demoStores,
        telegram: { enabled: bot.enabled, username: bot.username },
        usdRate: getUsdRate().rate,
      },
    };
  });
}
