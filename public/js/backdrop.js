// Фон сайту: розмитий кадр популярної гри вгорі сторінки, донизу тане у звичайний фон.
// Вітрина ставить гру з банера, сторінка гри — саму гру, решта сторінок — одну з популярних знижок.
import { get } from './api.js';

let box = null;
let layers = [];
let front = 0;
let wanted = '';
let featured = null;

// На телефоні банер займає 300 px, тож беремо легшу картинку (у 3–4 рази менше трафіку)
const phone = matchMedia('(max-width: 760px)');
/** Картинка банера для цього екрана. */
export const heroSrc = (d) => (phone.matches && d.heroSmall) || d.heroImage;

function mount() {
  box = document.createElement('div');
  box.className = 'page-backdrop';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = '<i></i><i></i>';
  document.body.prepend(box);
  layers = [...box.children];
}

/** Плавно змінює фон. Порожній url прибирає його. */
export function setBackdrop(url) {
  if (!box) mount();
  wanted = url || '';
  if (!url) {
    layers.forEach((l) => l.classList.remove('on'));
    return;
  }
  if (layers[front].dataset.url === url && layers[front].classList.contains('on')) return;
  // Новий кадр показуємо лише після завантаження, щоб не блимав порожній фон
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    if (wanted !== url) return; // поки вантажилось, користувач уже перейшов далі
    front = 1 - front;
    layers[front].style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    layers[front].dataset.url = url;
    layers[front].classList.add('on');
    layers[1 - front].classList.remove('on');
  };
  img.src = url;
}

/** Фон для звичайної сторінки: кожна сторінка отримує «свою» гру з популярних знижок. */
export async function setPageBackdrop(page) {
  wanted = `page:${page}`;
  const ticket = wanted;
  try {
    featured ??= (await get('/api/deals/featured')).items.map(heroSrc).filter(Boolean);
  } catch {
    featured = null; // офлайн чи сервер недоступний — спробуємо на наступній сторінці
    return;
  }
  if (wanted !== ticket || !featured.length) return; // сторінка вже поставила власний фон
  let hash = 0;
  for (const ch of page) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  setBackdrop(featured[hash % featured.length]);
}
