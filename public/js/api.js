// Запити до сервера. Помилки перетворюються на ApiError з людським повідомленням.

export class ApiError extends Error {
  constructor(message, status, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Немає зв’язку із сервером. Перевірте, чи він запущений', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // відповідь без JSON
  }

  if (!res.ok) {
    if (res.status === 401 && url !== '/api/auth/login') window.dispatchEvent(new CustomEvent('zk:unauthorized'));
    throw new ApiError(data?.error || `Помилка сервера (${res.status})`, res.status, data?.details?.field);
  }
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body) => api('POST', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);
