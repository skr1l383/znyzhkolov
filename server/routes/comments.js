// Коментарі до ігор: читати можуть усі, писати — ті, хто увійшов,
// видалити — автор або адміністратор (модерація).
import { requireAuth } from '../auth.js';
import { db, now } from '../db.js';
import { HttpError } from '../http.js';
import { log } from '../logger.js';
import * as v from '../validate.js';

export const COMMENT_MAX_LENGTH = 1000;
const PAGE_SIZE = 50;
const COOLDOWN_MS = 15 * 1000; // не частіше одного коментаря на 15 секунд — проти флуду

const SELECT = 'SELECT c.*, u.name, u.avatar, u.role FROM comments c JOIN users u ON u.id = c.user_id';

function gameOf(ctx) {
  const { store, id } = ctx.params;
  if (!['steam', 'gog'].includes(store) || !/^\d{1,12}$/.test(id)) throw new HttpError(404, 'Гру не знайдено');
  return { store, id };
}

/** Фото профілів доступні лише тим, хто увійшов, тож гостю показуємо літеру замість фото. */
function publicComment(c, viewer) {
  return {
    id: c.id,
    text: c.text,
    createdAt: c.created_at,
    author: {
      name: c.name,
      avatarUrl: viewer && c.avatar ? `/api/avatars/${c.avatar}` : null,
      isAdmin: c.role === 'admin',
    },
    mine: viewer?.id === c.user_id,
    canDelete: Boolean(viewer && (viewer.id === c.user_id || viewer.role === 'admin')),
  };
}

export function commentRoutes(router) {
  router.get('/api/games/:store/:id/comments', (ctx) => {
    const { store, id } = gameOf(ctx);
    const rows = db.prepare(`${SELECT} WHERE c.store = ? AND c.store_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(store, id, PAGE_SIZE);
    const total = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE store = ? AND store_id = ?').get(store, id).n;
    return { total, items: rows.map((c) => publicComment(c, ctx.user)) };
  });

  router.post('/api/games/:store/:id/comments', requireAuth, (ctx) => {
    const { store, id } = gameOf(ctx);
    const text = v.text(ctx.body.text, { field: 'text', label: 'Коментар', max: COMMENT_MAX_LENGTH });
    const last = db.prepare('SELECT created_at FROM comments WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(ctx.user.id);
    if (last && Date.now() - new Date(last.created_at).getTime() < COOLDOWN_MS) {
      throw new HttpError(429, 'Зачекай кілька секунд перед наступним коментарем');
    }
    const info = db
      .prepare('INSERT INTO comments (store, store_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(store, id, ctx.user.id, text, now());
    log.info('comment.add', `${ctx.user.email} прокоментував гру ${store}:${id}`, {
      userId: ctx.user.id,
      meta: { commentId: Number(info.lastInsertRowid) },
    });
    return { comment: publicComment(db.prepare(`${SELECT} WHERE c.id = ?`).get(info.lastInsertRowid), ctx.user) };
  });

  router.delete('/api/comments/:id', requireAuth, (ctx) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(v.id(ctx.params.id));
    if (!c) throw new HttpError(404, 'Коментар не знайдено');
    const byAdmin = c.user_id !== ctx.user.id;
    if (byAdmin && ctx.user.role !== 'admin') throw new HttpError(403, 'Видалити можна лише свій коментар');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    log.info('comment.delete', `${ctx.user.email} видалив ${byAdmin ? 'чужий ' : ''}коментар до гри ${c.store}:${c.store_id}`, {
      userId: ctx.user.id,
      meta: { commentId: c.id, authorId: c.user_id, byAdmin },
    });
    return { ok: true };
  });
}
