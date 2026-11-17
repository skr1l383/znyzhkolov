// Анімації інтерфейсу: картки по черзі з'являються, коли доходять до екрана, цифри статистики
// «набігають» від нуля, сторінка м'яко проявляється після переходу.
// Хто вимкнув анімації в системі (prefers-reduced-motion), бачить усе одразу й без руху.
import { locale } from './i18n.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Картки й блоки, з яких складаються сторінки
const REVEAL = [
  '.deal-card',
  '.game-card',
  '.result-card',
  '.notice',
  '.epic-card',
  '.epic-now',
  '.freebie',
  '.how-steps li',
  '.list-stats > div',
  '.stat',
  '.profile-stat:not(.skeleton)',
  '.regional-fact',
  '.notify-channel',
  '.ach',
  '.game-about',
  '.game-history',
  '.game-regional',
  '.game-side > *',
].join(',');
// Числа, які «набігають»
const COUNT = '.list-stats b, .stat b, .epic-stats b, .profile-stat b';
const STAGGER_MS = 45;
const MAX_STAGGER = 8; // далі затримка не росте, щоб довгий список не з'являвся вічність
const COUNT_MS = 900;

// Перше число в тексті разом з пробілами-розділювачами й дробовою частиною: «2 324,50 ₴» → «2 324,50»
const NUMBER = /\d(?:[\d   ]*\d)?(?:,\d+)?/;

function countUp(el) {
  const text = el.textContent;
  const match = NUMBER.exec(text);
  if (!match) return;
  const raw = match[0];
  const target = Number(raw.replace(/[   ]/g, '').replace(',', '.'));
  if (!(target > 1)) return; // 0 чи 1 «набігати» нікуди
  const decimals = raw.includes(',') ? raw.split(',')[1].length : 0;
  const format = new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + raw.length);
  const start = performance.now();
  const step = (now) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - start) / COUNT_MS);
    // Наприкінці повертаємо точно той текст, що був: формат сторінки, а не наш
    el.textContent = p < 1 ? before + format.format(target * (1 - (1 - p) ** 3)) + after : text;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initMotion(root) {
  if (reduced.matches || !('IntersectionObserver' in window)) return;

  const finish = (e) => {
    const el = e.currentTarget;
    if (e.target !== el) return; // анімація всередині картки (скелетон тощо) — не наша
    el.classList.remove('reveal', 'is-in');
    el.style.removeProperty('--reveal-delay');
    el.removeEventListener('animationend', finish);
  };

  const revealer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((e) => e.isIntersecting)
        .forEach((e, i) => {
          const el = e.target;
          revealer.unobserve(el);
          el.style.setProperty('--reveal-delay', `${Math.min(i, MAX_STAGGER) * STAGGER_MS}ms`);
          el.addEventListener('animationend', finish);
          el.classList.add('is-in');
        });
    },
    { rootMargin: '0px 0px -40px 0px' }
  );

  const counter = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      counter.unobserve(e.target);
      countUp(e.target);
    }
  });

  const track = (el) => {
    if (el.matches(REVEAL) && !el.closest('.reveal')) {
      el.classList.add('reveal'); // невидимий, доки не дійде до екрана
      revealer.observe(el);
    }
    if (el.matches(COUNT)) counter.observe(el);
  };

  // Сторінки малюють себе самі, тож стежимо за всім новим, що з'являється в #view
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        track(node);
        node.querySelectorAll(REVEAL).forEach(track);
        node.querySelectorAll(COUNT).forEach(track);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}

/** М'яка поява сторінки після переходу на іншу. */
export function pageEnter(root) {
  if (reduced.matches) return;
  root.classList.remove('view-enter');
  void root.offsetWidth; // перезапуск анімації
  root.classList.add('view-enter');
}
