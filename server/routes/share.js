// «Поділитися списком»: публічне посилання з випадковим ключем і QR-код до нього.
// За посиланням видно лише назви ігор і ціни — без пошти, умов сповіщень та інших особистих даних.
import crypto from 'node:crypto';
import { db } from '../db.js';
import { qrSvg } from '../formats/qr.js';
import { HttpError, sendFile } from '../http.js';
import { log } from '../logger.js';
import { requireAuth } from '../auth.js';
import { listWatch } from '../services/watch.js';

const tokenOf = (userId) => db.prepare('SELECT share_token FROM users WHERE id = ?').get(userId)?.share_token || null;

export function shareRoutes(router) {
  router.get('/api/me/share', requireAuth, (ctx) => ({ token: tokenOf(ctx.user.id) }));

  router.post('/api/me/share', requireAuth, (ctx) => {
    let token = tokenOf(ctx.user.id);
    if (!token) {
      // 12 випадкових байтів — вгадати чуже посилання практично неможливо
      token = crypto.randomBytes(12).toString('base64url');
      db.prepare('UPDATE users SET share_token = ? WHERE id = ?').run(token, ctx.user.id);
      log.info('share.create', `${ctx.user.email} відкрив доступ до свого списку за посиланням`, { userId: ctx.user.id });
    }
    return { token };
  });

  // Вимкнути посилання: старий QR-код і посилання перестають працювати
  router.delete('/api/me/share', requireAuth, (ctx) => {
    db.prepare('UPDATE users SET share_token = NULL WHERE id = ?').run(ctx.user.id);
    log.info('share.revoke', `${ctx.user.email} закрив доступ до свого списку`, { userId: ctx.user.id });
    return { token: null };
  });

  router.get('/api/shared/:token', (ctx) => {
    const token = String(ctx.params.token);
    if (!/^[\w-]{10,40}$/.test(token)) throw new HttpError(404, 'Посилання недійсне');
    const owner = db.prepare('SELECT id, name FROM users WHERE share_token = ?').get(token);
    if (!owner) throw new HttpError(404, 'Посилання недійсне або власник закрив доступ до списку');

    // Що вже є у списку того, хто дивиться, — щоб позначити «У тебе в списку»
    const mine = new Set(
      ctx.user && ctx.user.id !== owner.id
        ? listWatch(ctx.user.id).flatMap((w) => w.offers.map((o) => `${o.store}:${o.storeId}`))
        : []
    );
    const items = listWatch(owner.id).map((w) => ({
      title: w.title,
      imageUrl: w.imageUrl,
      bestStore: w.bestStore,
      offers: w.offers.map((o) => ({
        store: o.store,
        storeId: o.storeId,
        title: o.title,
        url: o.url,
        currency: o.currency,
        price: o.price,
        basePrice: o.basePrice,
        discount: o.discount,
        priceUah: o.priceUah,
        basePriceUah: o.basePriceUah,
        available: o.available,
      })),
      inMyList: w.offers.some((o) => mine.has(`${o.store}:${o.storeId}`)),
    }));
    return { owner: { name: owner.name }, isMine: ctx.user?.id === owner.id, items };
  });

  // QR-код як картинка SVG: /api/qr.svg?text=...
  router.get('/api/qr.svg', (ctx) => {
    const text = String(ctx.query.text || '');
    if (!text || text.length > 1000) throw new HttpError(400, 'Текст для QR-коду має бути від 1 до 1000 символів');
    sendFile(ctx.res, Buffer.from(qrSvg(text, { level: 'M' })), { type: 'image/svg+xml', cache: 'public, max-age=86400' });
  });
}
