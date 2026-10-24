// Запити до сервера. Помилки перетворюються на ApiError з людським повідомленням.
import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(message, status, field, details = null) {
    super(message);
    this.status = status;
    this.field = field;
    this.details = details; // додаткові відомості від сервера (наприклад, код помилки)
  }
}

/**
 * Повідомлення сервера приходять українською. Якщо фраза є у словнику — показуємо переклад;
 * для повідомлень із підставленими значеннями сервер додає шаблон (details.i18n), і перекладаємо його.
 */
function errorText(data, status) {
  const tpl = data?.details?.i18n;
  if (tpl) {
    const vars = Object.fromEntries(Object.entries(tpl.vars || {}).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v]));
    return t(tpl.text, vars);
  }
  return t(data?.error || 'Помилка сервера ({status})', { status });
}

export function api(method, url, body) {
  return send(url, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
}

/** Надсилає файл «як є» в тілі запиту; ім'я файлу — в заголовку X-File-Name. */
export function upload(url, file) {
  return send(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
}

async function send(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch {
    window.dispatchEvent(new CustomEvent('zk:offline'));
    throw new ApiError(navigator.onLine ? t('Немає зв’язку із сервером. Перевірте, чи він запущений') : t('Немає інтернету. Спробуй, щойно з’явиться зв’язок'), 0);
  }

  // Service worker віддав збережену копію — значить, сервер або інтернет недоступні
  window.dispatchEvent(new CustomEvent(res.headers.get('X-Zk-Offline') ? 'zk:offline' : 'zk:online'));

  let data = null;
  try {
    data = await res.json();
  } catch {
    // відповідь без JSON
  }

  if (!res.ok) {
    if (res.status === 401 && url !== '/api/auth/login') window.dispatchEvent(new CustomEvent('zk:unauthorized'));
    throw new ApiError(errorText(data, res.status), res.status, data?.details?.field, data?.details || null);
  }
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body) => api('POST', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);
