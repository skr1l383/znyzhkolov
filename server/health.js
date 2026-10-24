// Стан бази даних для решти сервера: чи можна працювати з даними, і запис у журнал,
// коли база стає недоступною або знову оживає (один раз, а не на кожен запит).
import { dbError, ensureDb, isDbUnavailable } from './db.js';
import { HttpError } from './http.js';
import { log } from './logger.js';

let down = false;

/** true, якщо база працює; якщо ні — ensureDb щоразу пробує відкрити її знову. */
export function dbAvailable() {
  const ok = ensureDb();
  if (ok && down) log.info('db.restored', 'База даних знову доступна');
  if (!ok && !down) log.error('db.unavailable', `База даних недоступна: ${dbError()?.message || 'невідома помилка'}`);
  down = !ok;
  return ok;
}

/** Відповідь користувачу, коли база недоступна: 503 і зрозуміле повідомлення замість «Внутрішня помилка». */
export const dbDownError = () => new HttpError(503, 'База даних тимчасово недоступна. Спробуй трохи пізніше', { code: 'db_unavailable' });

/** Перетворює помилку бази, що сталася посеред запиту, на dbDownError; інші помилки не чіпає. */
export const mapDbError = (err) => (isDbUnavailable(err) ? dbDownError() : null);
