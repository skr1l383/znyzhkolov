// Вхід через Google (OAuth 2.0, «authorization code flow»):
// 1) /api/auth/google — переадресовуємо на сторінку входу Google з випадковим state у cookie (захист від підробленого запиту);
// 2) Google повертає людину на /api/auth/google/callback з одноразовим кодом;
// 3) сервер сам обмінює код на токен (з секретом, якого браузер не бачить), дізнається пошту й ім'я
//    і входить у наявний акаунт з цією поштою або створює новий.
import crypto from 'node:crypto';
import { config, isHttps } from '../config.js';
import { db, nameKey, now } from '../db.js';
import { createSession, sessionCookie } from '../auth.js';
import { serializeCookie } from '../http.js';
import { log } from '../logger.js';

const START = '/api/auth/google';
const CALLBACK = '/api/auth/google/callback';
const STATE_COOKIE = 'zk_oauth';

export const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);
const redirectUri = () => `${config.baseUrl}${CALLBACK}`;
const stateCookie = (value, maxAge) => serializeCookie(STATE_COOKIE, value, { maxAge, secure: isHttps, path: START });

function redirect(ctx, location, cookies = []) {
  ctx.res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length && { 'Set-Cookie': cookies }) });
  ctx.res.end();
}

/** Вільний нік з імені в Google: «Олександр», а якщо зайнятий — «Олександр 2», «Олександр 3»… */
function freeNickname(base) {
  let clean = String(base || '').replace(/@/g, '').trim().slice(0, 34);
  if (clean.length < 2) clean = 'Гравець';
  for (let i = 1; ; i++) {
    const name = i === 1 ? clean : `${clean} ${i}`;
    if (!db.prepare('SELECT 1 FROM users WHERE name_key = ?').get(nameKey(name))) return name;
  }
}

/** Обмін коду на токен і профіль Google. Токен приходить напряму від Google по HTTPS, тож профілю можна довіряти. */
async function fetchGoogleProfile(code) {
  const tokenRes = await fetch(config.google.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new Error(`токен: ${token.error || tokenRes.status}`);

  const infoRes = await fetch(config.google.userinfoUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  const profile = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !profile.sub || !profile.email) throw new Error(`профіль: ${profile.error || infoRes.status}`);
  if (profile.email_verified === false) throw new Error('пошту не підтверджено в Google');
  return profile;
}

/** Акаунт для профілю Google: за ідентифікатором Google, інакше за поштою (і прив'язуємо), інакше — новий. */
function userForProfile(profile, lang) {
  const email = String(profile.email).toLowerCase();
  const existing =
    db.prepare('SELECT * FROM users WHERE google_sub = ?').get(profile.sub) || db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    // Google вже перевірив, що пошта належить цій людині, — тож і в нас вона підтверджена
    db.prepare('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?), last_login_at = ? WHERE id = ?').run(
      profile.sub,
      now(),
      now(),
      existing.id
    );
    return { user: existing, created: false };
  }

  // Адміністратор — пошта з ADMIN_EMAIL, як і при звичайній реєстрації
  const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const role = (config.adminEmail ? email === config.adminEmail : isFirst) ? 'admin' : 'user';
  const name = freeNickname(profile.name || profile.given_name || email.split('@')[0]);
  // Пароля немає (порожній хеш): увійти можна через Google або задати пароль через «Забули пароль?»
  const info = db
    .prepare(
      `INSERT INTO users (email, name, name_key, password_hash, role, lang, email_verified_at, google_sub, created_at, last_login_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`
    )
    .run(email, name, nameKey(name), role, lang, now(), profile.sub, now(), now());
  return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid), created: true };
}

export function googleRoutes(router) {
  router.get(START, (ctx) => {
    if (!googleEnabled()) return redirect(ctx, '/#/login');
    const state = crypto.randomBytes(16).toString('base64url');
    const lang = ctx.query.lang === 'en' ? 'en' : 'uk';
    const url = new URL(config.google.authUrl);
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      hl: lang,
    }).toString();
    // Мова сайту їде разом зі state: новий акаунт отримає листи й сповіщення цією мовою
    redirect(ctx, url.href, [stateCookie(`${state}.${lang}`, 600)]);
  });

  router.get(CALLBACK, async (ctx) => {
    const clearState = stateCookie('', 0);
    const fail = (reason, hash = '#/login?google=failed') => {
      log.warn('auth.google_failed', `Вхід через Google не вдався: ${reason}`, { meta: { ip: ctx.ip } });
      redirect(ctx, `/${hash}`, [clearState]);
    };
    if (!googleEnabled()) return redirect(ctx, '/#/login');
    // Людина натиснула «Скасувати» на сторінці Google — просто повертаємо на вхід
    if (ctx.query.error) return fail(ctx.query.error, '#/login');

    const [state, lang = 'uk'] = String(ctx.cookies[STATE_COOKIE] || '').split('.');
    if (!state || ctx.query.state !== state || !ctx.query.code) return fail('state не збігається');

    let profile;
    try {
      profile = await fetchGoogleProfile(String(ctx.query.code));
    } catch (err) {
      return fail(err.message);
    }

    const { user, created } = userForProfile(profile, lang === 'en' ? 'en' : 'uk');
    const token = createSession(user.id, ctx.req.headers['user-agent']);
    log.info(created ? 'auth.register' : 'auth.login', `${created ? 'Новий користувач через Google' : 'Вхід через Google'}: ${user.email}`, {
      userId: user.id,
      meta: { ip: ctx.ip, google: true },
    });
    // Новачка — одразу на «Мій список», де є добірка знижок для першої гри
    redirect(ctx, created ? '/#/list' : '/#/', [clearState, sessionCookie(token)]);
  });
}
