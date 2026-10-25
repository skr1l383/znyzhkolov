// Маленький веб-фреймворк на вбудованому модулі node:http:
// маршрути, розбір JSON, cookies, віддача статичних файлів і заголовки безпеки.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Помилка з шаблоном на кшталт «Поле «{label}» має містити не більше {max} символів».
 * Текст підставляється українською, а шаблон зі значеннями йде в details.i18n — так інтерфейс
 * англійською покаже переклад того самого шаблону.
 */
export function templateError(status, template, vars, details = {}) {
  const message = template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
  return new HttpError(status, message, { ...details, i18n: { text: template, vars } });
}

const MAX_BODY = 1024 * 1024; // 1 МБ для JSON-запитів

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    // Трейлери Steam (HLS) завантажує hls.js і програє через blob:, трейлери GOG — вбудований YouTube
    "connect-src 'self' https://video.akamai.steamstatic.com",
    "media-src 'self' blob: https://video.akamai.steamstatic.com",
    "frame-src https://www.youtube-nocookie.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}`;
  if (opts.maxAge != null) str += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.httpOnly !== false) str += '; HttpOnly';
  str += `; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.secure) str += '; Secure';
  return str;
}

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Запит завеликий');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  if (!type.includes('application/json')) throw new HttpError(415, 'Очікується JSON');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Некоректний JSON у тілі запиту');
  }
}

const toMb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Читає файл, надісланий у тілі запиту (маршрути router.upload).
 * Розмір перевіряється двічі: за заголовком Content-Length ще до читання
 * і під час читання, якщо заголовок збрехав або його немає.
 */
export async function readUpload(req, { maxBytes }) {
  const tooBig = () => templateError(413, 'Файл завеликий: максимум {mb} МБ', { mb: toMb(maxBytes) });
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) {
    req.resume(); // дочитуємо й відкидаємо, щоб браузер отримав зрозумілу відповідь
    throw tooBig();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= maxBytes) chunks.push(chunk);
  }
  if (size > maxBytes) throw tooBig();
  if (!size) throw new HttpError(400, 'Файл порожній');
  let name = '';
  try {
    name = decodeURIComponent(req.headers['x-file-name'] || '');
  } catch {
    // ім'я файлу необов'язкове
  }
  return { buffer: Buffer.concat(chunks), name: name.slice(0, 200) };
}

/** Віддає файл (Buffer) у відповідь: картинку для показу або документ для завантаження. */
export function sendFile(res, buffer, { type, filename, cache = 'no-store' }) {
  const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': buffer.length, 'Cache-Control': cache };
  if (filename) {
    // ASCII-ім'я для старих браузерів і повне UTF-8 ім'я для решти
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    headers['Content-Disposition'] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  res.writeHead(200, headers);
  res.end(buffer);
}

export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handlers, opts = {}) {
    this.routes.push({ method, ...compile(pattern), handlers, ...opts });
  }
  get(p, ...h) { this.add('GET', p, h); }
  post(p, ...h) { this.add('POST', p, h); }
  patch(p, ...h) { this.add('PATCH', p, h); }
  delete(p, ...h) { this.add('DELETE', p, h); }
  /** POST, у тілі якого файл, а не JSON. Обробник читає його через readUpload. */
  upload(p, ...h) { this.add('POST', p, h, { upload: true }); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function sendJson(res, status, data, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function serveStatic(publicDir, pathname, req, res) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return false;
  }
  const file = path.normalize(path.join(publicDir, rel));
  // Захист від виходу за межі папки public (../../)
  if (!file.startsWith(publicDir + path.sep)) return false;

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  const isSw = path.basename(file) === 'sw.js';
  // Код і стилі браузер щоразу звіряє з сервером (304, якщо файл не змінився) — нова версія сайту видна одразу.
  // Картинки й шрифти змінюються рідко, їх можна тримати 5 хвилин без перевірки.
  const isCode = isHtml || isSw || ext === '.js' || ext === '.css' || ext === '.webmanifest';
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const cacheHeaders = { ETag: etag, 'Cache-Control': isCode ? 'no-cache' : 'public, max-age=300' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cacheHeaders);
    res.end();
    return true;
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    // Service worker сам завантажує обкладинки зі Steam і GOG, щоб зберегти їх для офлайну,
    // тому йому потрібен дозвіл на https-запити (сторінки лишаються з суворими правилами)
    ...(isSw ? { 'Content-Security-Policy': "default-src 'self'; connect-src 'self' https:" } : {}),
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    ...cacheHeaders,
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * Створює обробник запитів.
 * Обробник маршруту отримує ctx і повертає об'єкт (буде надісланий як JSON)
 * або кидає HttpError. Проміжні обробники (наприклад, перевірка входу)
 * повертають undefined, і тоді виконується наступний.
 */
/**
 * mapError(err) — можна перетворити неочікувану помилку на зрозумілу HttpError
 * (наприклад, «база даних недоступна» → 503); подробиці однаково йдуть в onError.
 */
export function createApp({ router, publicDir, onError, beforeRoute, mapError }) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    if (!pathname.startsWith('/api/')) {
      if (method === 'GET' && serveStatic(publicDir, pathname, req, res)) return;
      if (method === 'GET' && !path.extname(pathname)) {
        if (serveStatic(publicDir, '/index.html', req, res)) return;
      }
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    const ctx = {
      req,
      res,
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams),
      params: {},
      body: {},
      cookies: parseCookies(req.headers.cookie),
      ip: req.socket.remoteAddress || '',
      user: null,
      setHeaders: {},
    };

    try {
      const found = router.match(method, pathname);
      if (!found) throw new HttpError(404, 'Такого API не існує');
      if (found.methodNotAllowed) throw new HttpError(405, 'Метод не підтримується');
      ctx.params = found.params;

      if (method !== 'GET') {
        // Захист від CSRF: запити, що змінюють дані, приймаються лише з нашого ж сайту
        const origin = req.headers.origin;
        if (origin) {
          let originHost = '';
          try {
            originHost = new URL(origin).host;
          } catch {
            // некоректний Origin
          }
          if (originHost !== req.headers.host) throw new HttpError(403, 'Запит з іншого сайту заблоковано');
        }
        if (!found.route.upload) ctx.body = await readJson(req);
      }

      if (beforeRoute) await beforeRoute(ctx);

      let result;
      for (const h of found.route.handlers) {
        result = await h(ctx);
        if (result !== undefined || res.headersSent) break;
      }
      if (!res.headersSent) sendJson(res, 200, result ?? { ok: true }, ctx.setHeaders);
    } catch (err) {
      // Очікувані помилки (HttpError) показуємо як є; неочікувані — записуємо в журнал
      // і не розкриваємо подробиць користувачу
      const expected = err instanceof HttpError;
      if (!expected && onError) onError(err, ctx);
      const known = expected ? err : mapError?.(err);
      const status = known ? known.status : 500;
      const message = known ? known.message : 'Внутрішня помилка сервера';
      sendJson(res, status, { error: message, details: known?.details }, ctx.setHeaders);
    }
  };
}
