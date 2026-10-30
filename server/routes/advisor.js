// ШІ-порадник на сторінці гри: POST /api/advisor.
// Відповідь містить модель і кількість токенів; якщо ШІ недоступний — 503 з поясненням, решта сайту працює.
import { requireAuth } from '../auth.js';
import { HttpError, templateError } from '../http.js';
import { AiError, advise } from '../services/advisor.js';
import * as v from '../validate.js';

// Безкоштовний ключ має денний ліміт на весь сайт, тож одна людина не може витратити його сама
const LIMIT_PER_HOUR = 20;
const used = new Map(); // userId → { count, resetAt }

function checkRate(userId) {
  const now = Date.now();
  const entry = used.get(userId);
  if (!entry || entry.resetAt <= now) {
    used.set(userId, { count: 1, resetAt: now + 3600 * 1000 });
    return;
  }
  if (entry.count >= LIMIT_PER_HOUR) {
    const minutes = Math.ceil((entry.resetAt - now) / 60000);
    throw templateError(429, 'Порадник відповідає не більше {n} разів на годину. Спробуй за {minutes} хв.', { n: LIMIT_PER_HOUR, minutes });
  }
  entry.count += 1;
}

/** Чому ШІ не відповів — зрозумілою мовою; code підказує інтерфейсу, що сталося. */
function aiError(code) {
  if (code === 'off') return new HttpError(503, 'ШІ-порадник на цьому сервері не налаштований', { code: 'ai_off' });
  if (code === 'quota') {
    return new HttpError(503, 'ШІ-порадник вичерпав безкоштовний ліміт запитів. Спробуй за хвилину — решта сайту працює як звичайно', { code: 'ai_quota' });
  }
  return new HttpError(503, 'ШІ-порадник тимчасово недоступний. Решта сайту працює як звичайно — спробуй трохи пізніше', { code: 'ai_unavailable' });
}

export function advisorRoutes(router) {
  router.post('/api/advisor', async (ctx) => {
    requireAuth(ctx);
    const body = ctx.body || {};
    const store = String(body.store || '');
    const storeId = String(body.id || '');
    if (!['steam', 'gog'].includes(store) || !/^\d{1,12}$/.test(storeId)) throw new HttpError(404, 'Гру не знайдено');
    const question = v.text(body.question ?? '', { field: 'question', label: 'Питання', max: 500, required: false });
    // Попередні репліки розмови: не більше 6 і обмеженої довжини — щоб не роздувати запит до моделі
    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-6)
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({ role: m.role === 'model' ? 'model' : 'user', text: m.text.slice(0, 1500) }));

    checkRate(ctx.user.id);
    try {
      const result = await advise({ store, storeId, question, history, lang: body.lang === 'en' ? 'en' : 'uk', userId: ctx.user.id });
      if (!result) throw new HttpError(404, 'Гру не знайдено');
      return result;
    } catch (err) {
      if (err instanceof AiError) throw aiError(err.code);
      throw err;
    }
  });
}
