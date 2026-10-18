import { config } from '../config.js';
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import {
  SESSION_COOKIE,
  checkLoginRate,
  clearSessionCookie,
  createEmailToken,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  publicUser,
  registerLoginFailure,
  requireAuth,
  resetLoginFailures,
  sessionCookie,
  useEmailToken,
  verifyPassword,
} from '../auth.js';
import { emailLayout, mailProvider, sendMail, siteLink } from '../services/mailer.js';
import { botStatus } from '../services/telegram.js';
import { getUsdRate } from '../stores/currency.js';
import * as v from '../validate.js';

const VERIFY_MINUTES = 3 * 24 * 60; // посилання для підтвердження пошти діє 3 дні
const RESET_MINUTES = 60; // для відновлення пароля — годину

/** Простий обмежувач: не більше limit дій за windowMs для одного ключа (пошта, IP). */
const hits = new Map();
function tooOften(key, { limit, windowMs }) {
  const nowMs = Date.now();
  const recent = (hits.get(key) || []).filter((t) => nowMs - t < windowMs);
  if (recent.length >= limit) return true;
  recent.push(nowMs);
  hits.set(key, recent);
  return false;
}

async function sendVerificationEmail(user) {
  const token = createEmailToken(user.id, 'verify', VERIFY_MINUTES);
  const { html, text } = emailLayout({
    heading: `Підтверди пошту, ${user.name}`,
    paragraphs: [
      'Дякуємо за реєстрацію в Знижколові! Натисни кнопку, щоб підтвердити, що це твоя пошта.',
      'Після цього ми зможемо надсилати тобі сповіщення про знижки і, якщо знадобиться, допомогти відновити пароль.',
    ],
    button: { label: 'Підтвердити пошту', url: siteLink(`#/verify?token=${token}`) },
    footnote: 'Посилання діє 3 дні. Якщо ти не реєструвався в Знижколові, просто проігноруй цей лист.',
  });
  return sendMail({ to: user.email, subject: 'Підтвердь пошту в Знижколові', html, text, kind: 'verify', userId: user.id });
}

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
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    await sendVerificationEmail(user); // помилка пошти не заважає реєстрації — лист можна надіслати ще раз
    return { user: publicUser(user) };
  });

  // Підтвердження пошти за посиланням з листа (працює і без входу — лист могли відкрити на телефоні)
  router.post('/api/auth/verify', (ctx) => {
    const userId = useEmailToken(ctx.body.token, 'verify');
    if (!userId) throw new HttpError(400, 'Посилання недійсне або вже використане. Увійди й надішли новий лист із профілю');
    db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(now(), userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    log.info('auth.verified', `${user.email} підтвердив пошту`, { userId });
    return { user: publicUser(user) };
  });

  router.post('/api/auth/verify/resend', requireAuth, async (ctx) => {
    if (ctx.user.email_verified_at) return { ok: true, already: true };
    if (tooOften(`verify:${ctx.user.id}`, { limit: 1, windowMs: 60000 })) {
      throw new HttpError(429, 'Лист уже надіслано. Повторити можна за хвилину');
    }
    const result = await sendVerificationEmail(ctx.user);
    if (!result.ok) throw new HttpError(502, 'Не вдалося надіслати лист. Спробуй трохи пізніше');
    return { ok: true };
  });

  // «Забули пароль?» Відповідь завжди однакова — так не можна дізнатися, чи є така пошта в системі
  router.post('/api/auth/forgot', async (ctx) => {
    const email = v.email(ctx.body.email);
    const answer = { ok: true, message: 'Якщо такий акаунт є, ми надіслали лист із посиланням для зміни пароля. Перевір пошту (і папку «Спам»).' };
    if (tooOften(`forgot-ip:${ctx.ip}`, { limit: 5, windowMs: 15 * 60000 }) || tooOften(`forgot:${email}`, { limit: 1, windowMs: 60000 })) {
      throw new HttpError(429, 'Забагато запитів. Спробуй за кілька хвилин');
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      log.info('auth.forgot', `Запит відновлення пароля для неіснуючої пошти ${email}`, { meta: { ip: ctx.ip } });
      return answer;
    }
    const token = createEmailToken(user.id, 'reset', RESET_MINUTES);
    const { html, text } = emailLayout({
      heading: 'Відновлення пароля',
      paragraphs: [`Привіт, ${user.name}! Хтось (сподіваємось, ти) попросив змінити пароль до Знижколова.`, 'Натисни кнопку й вигадай новий пароль.'],
      button: { label: 'Змінити пароль', url: siteLink(`#/reset?token=${token}`) },
      footnote: 'Посилання діє годину і спрацює лише один раз. Якщо ти не просив змінити пароль, нічого не роби — старий пароль працює.',
    });
    await sendMail({ to: user.email, subject: 'Відновлення пароля в Знижколові', html, text, kind: 'reset', userId: user.id });
    log.info('auth.forgot', `${user.email} запросив відновлення пароля`, { userId: user.id, meta: { ip: ctx.ip } });
    return answer;
  });

  // Новий пароль за посиланням з листа: старі сесії на всіх пристроях завершуються
  router.post('/api/auth/reset', async (ctx) => {
    const password = v.password(ctx.body.password);
    const userId = useEmailToken(ctx.body.token, 'reset');
    if (!userId) throw new HttpError(400, 'Посилання недійсне, застаріло або вже використане. Запроси новий лист');
    db.prepare('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(
      await hashPassword(password),
      now(), // лист прийшов на цю пошту — отже, вона справжня
      userId
    );
    destroyUserSessions(userId);
    const token = createSession(userId, ctx.req.headers['user-agent']);
    ctx.setHeaders['Set-Cookie'] = sessionCookie(token);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    log.info('auth.reset', `${user.email} змінив пароль за посиланням з листа`, { userId });
    return { user: publicUser(user) };
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
        mail: mailProvider(), // 'outbox' — тестова скринька замість справжньої пошти
      },
    };
  });
}
