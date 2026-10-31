// Пуш-сповіщення: ключ сайту для браузера, підписка пристрою, відписка і тестове сповіщення.
import { requireAuth } from '../auth.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import { allowedEndpoint, pushDeviceCount, pushToUser, removeSubscription, saveSubscription, vapidKeys } from '../services/webpush.js';

const B64U = /^[A-Za-z0-9_-]+$/;

/** Підписка з браузера (PushSubscription.toJSON()): адреса сервісу та ключі шифрування. */
function cleanSubscription(body) {
  const endpoint = String(body?.endpoint || '');
  const p256dh = String(body?.keys?.p256dh || '');
  const auth = String(body?.keys?.auth || '');
  if (endpoint.length > 1000 || !allowedEndpoint(endpoint)) throw new HttpError(400, 'Невідомий сервіс сповіщень');
  // Публічний ключ P-256 — 65 байтів (87 символів base64url), секрет — 16 байтів (22 символи)
  if (!B64U.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65 || !B64U.test(auth) || Buffer.from(auth, 'base64url').length !== 16) {
    throw new HttpError(400, 'Некоректні ключі підписки');
  }
  return { endpoint, p256dh, auth };
}

export function pushRoutes(router) {
  router.get('/api/push/key', requireAuth, () => ({ publicKey: vapidKeys().publicKey }));

  router.post('/api/push/subscriptions', requireAuth, (ctx) => {
    const sub = cleanSubscription(ctx.body);
    saveSubscription(ctx.user.id, sub, ctx.req.headers['user-agent']);
    log.info('push.subscribe', `${ctx.user.email} увімкнув пуш-сповіщення на пристрої`, { userId: ctx.user.id });
    return { ok: true, devices: pushDeviceCount(ctx.user.id) };
  });

  router.delete('/api/push/subscriptions', requireAuth, (ctx) => {
    removeSubscription(ctx.user.id, String(ctx.body?.endpoint || ''));
    return { ok: true, devices: pushDeviceCount(ctx.user.id) };
  });

  router.post('/api/push/test', requireAuth, async (ctx) => {
    const en = ctx.user.lang === 'en';
    const delivered = await pushToUser(ctx.user.id, {
      title: en ? 'Push notifications work!' : 'Пуш-сповіщення працюють!',
      body: en ? 'This is how Znyzhkolov will tell you about discounts.' : 'Саме так Знижколов повідомлятиме про знижки.',
      url: '/#/notifications',
      tag: 'test',
    });
    if (!delivered) throw new HttpError(502, 'Не вдалося доставити сповіщення. Спробуй вимкнути й увімкнути їх знову');
    return { ok: true, delivered };
  });
}
