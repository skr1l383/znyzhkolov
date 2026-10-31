// Service worker Знижколова: робить сайт застосунком, який можна встановити і який відкривається без інтернету.
//
// Стратегії:
//  • файли сайту й запити до API — «спершу мережа»: онлайн завжди свіже, офлайн — остання збережена копія;
//  • обкладинки ігор і шрифти з інших сайтів — «спершу кеш»: вони не змінюються, а сторінка відкривається швидше;
//  • відео, POST-запити тощо не чіпаємо.

// Будь-яка зміна цього файлу (наприклад, версії) змушує браузер встановити service worker заново.
// v2: перша версія могла встановитися із суворою CSP і блокувати обкладинки — нова її замінює.
// v4: додано файли перекладу (i18n). v5: при 503 (база недоступна) — збережені дані. v6: коментарі. v7: карта цін. v10: вхід через Google повз service worker.
const VERSION = 'v19';
const SHELL_CACHE = `zk-shell-${VERSION}`;
const API_CACHE = 'zk-api'; // очищається при виході з акаунта
const IMAGE_CACHE = 'zk-images';
const IMAGE_LIMIT = 400;

// Усе, що потрібно, щоб інтерфейс відкрився офлайн уже після першого відвідування
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/css/style.css',
  '/fonts/manrope-cyrillic.woff2',
  '/fonts/manrope-latin.woff2',
  '/fonts/unbounded-cyrillic.woff2',
  '/fonts/unbounded-latin.woff2',
  '/img/icon.svg',
  '/img/icon-192.png',
  '/js/theme-init.js',
  '/js/app.js',
  '/js/advisor.js',
  '/js/api.js',
  '/js/push.js',
  '/js/backdrop.js',
  '/js/ui.js',
  '/js/i18n.js',
  '/js/i18n-en.js',
  '/js/chart.js',
  '/js/worldmap.js',
  '/js/views/account.js',
  '/js/views/admin.js',
  '/js/views/auth.js',
  '/js/views/comments.js',
  '/js/views/conditions.js',
  '/js/views/epic.js',
  '/js/views/game.js',
  '/js/views/notifications.js',
  '/js/views/privacy.js',
  '/js/views/profile.js',
  '/js/views/regional.js',
  '/js/views/search.js',
  '/js/views/share.js',
  '/js/views/showcase.js',
  '/js/views/steamImport.js',
  '/js/qrscan.js',
  '/js/views/watchlist.js',
];

const CACHED_HOSTS = ['steamstatic.com', 'gog-statics.com', 'epicgames.com', 'ytimg.com', 'youtube.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // allSettled: якщо якийсь файл недоступний, решта однаково збережеться
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zk-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // Сторінкам, відкритим ще зі старою версією, кажемо перезавантажитися
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'sw-activated', version: VERSION })))
  );
});

/** Позначаємо відповідь, взяту з кешу: сторінка покаже «ти офлайн, це збережені дані». */
async function markOffline(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Zk-Offline', '1');
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

async function networkFirst(request, cacheName, { fallbackUrl } = {}) {
  const cache = await caches.open(cacheName);
  try {
    // no-cache: завжди питаємо сервер, а не звичайний кеш браузера — нова версія сайту доходить одразу
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    // Сервер працює, але база даних недоступна (503) — краще показати збережені дані, ніж помилку
    if (response.status === 503 && request.url.includes('/api/')) {
      const cached = await cache.match(request);
      if (cached) return markOffline(cached);
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (cached) return markOffline(cached);
    if (request.url.includes('/api/')) {
      return new Response(JSON.stringify({ error: 'Немає інтернету, а ці дані ще не збережені на пристрої' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Zk-Offline': '1' },
      });
    }
    throw new Error('offline');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Картинки з інших сайтів приходять «непрозорими» (status 0) — їх теж можна зберегти й показати
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

/** Найстаріші картинки видаляємо, щоб кеш не ріс безмежно. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT))) await cache.delete(key);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname === '/sw.js') return;
    // Вхід через Google — переадресації на інший сайт і назад: браузер обробляє їх сам
    if (url.pathname.startsWith('/api/auth/google')) return;
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL_CACHE, { fallbackUrl: '/' }));
    } else if (url.pathname.startsWith('/api/')) {
      // Експорт файлів і т. п. не зберігаємо — лише дані для сторінок
      if (url.pathname.startsWith('/api/watch/export') || url.pathname.endsWith('.pdf')) return;
      event.respondWith(networkFirst(request, API_CACHE));
    } else {
      event.respondWith(networkFirst(request, SHELL_CACHE));
    }
    return;
  }

  const external = CACHED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  if (external && (request.destination === 'image' || request.destination === 'font' || request.destination === 'style')) {
    event.respondWith(cacheFirst(request));
  }
});

// ---------- Пуш-сповіщення ----------
// Сервер шифрує повідомлення ключами цього браузера; тут воно вже розшифроване: { title, body, url, image, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { body: event.data?.text() || '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Знижколов', {
      body: data.body || '',
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      image: data.image || undefined,
      tag: data.tag || undefined, // те саме сповіщення про ту саму гру замінює попереднє, а не множиться
      data: { url: data.url || '/#/notifications' },
    })
  );
});

// Натискання на сповіщення: якщо сайт уже відкрито — переходимо в ньому, інакше відкриваємо нове вікно
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#/notifications', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => open.postMessage({ type: 'open', url }));
      }
      return self.clients.openWindow(url);
    })()
  );
});
