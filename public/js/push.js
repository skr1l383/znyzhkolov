// Пуш-сповіщення на цьому пристрої: підписка через service worker і PushManager браузера.
// Сервер зберігає лише «адресу» сервісу сповіщень і ключі шифрування — самі сповіщення показує service worker.
import { api, get, post } from './api.js';
import { t } from './i18n.js';

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => Boolean(navigator.standalone) || matchMedia('(display-mode: standalone)').matches;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) || null;
}

/**
 * Що з пушами на цьому пристрої:
 * on — увімкнено, off — можна ввімкнути, denied — заборонено в браузері,
 * ios-install — iPhone без встановлення на головний екран, unsupported — браузер не вміє.
 */
export async function pushState() {
  if (!supported()) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'on' : 'off';
}

const keyBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Питає дозвіл, підписує пристрій і передає підписку серверу. Викликати з натискання кнопки. */
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('Браузер не дозволив сповіщення. Дозволь їх у налаштуваннях сайту й спробуй ще раз.'));
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await get('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await post('/api/push/subscriptions', sub.toJSON());
}

/** Вимикає пуші на цьому пристрої (і на сервері, і в браузері). Помилки сервера не заважають відписатися. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('DELETE', '/api/push/subscriptions', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export const testPush = () => post('/api/push/test');
