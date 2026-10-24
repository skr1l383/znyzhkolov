// Переклад інтерфейсу: українська — основна мова, англійська — додаткова.
// Ключ перекладу — сама українська фраза (як у gettext, яким перекладають Linux і WordPress):
// t('Мій список') → 'My list'. Якщо перекладу немає, лишається українська фраза — сторінка не ламається.
import { EN } from './i18n-en.js';

export const LANGS = {
  uk: { short: 'UA', name: 'Українська', locale: 'uk-UA' },
  en: { short: 'EN', name: 'English', locale: 'en-GB' },
};

function initialLang() {
  try {
    const saved = localStorage.getItem('zk-lang');
    if (saved in LANGS) return saved;
  } catch {
    // без localStorage — мова за замовчуванням
  }
  return 'uk';
}

let lang = initialLang();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const locale = () => LANGS[lang].locale;

export function setLang(next) {
  if (!(next in LANGS)) return;
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('zk-lang', next);
  } catch {
    // вибір мови діятиме до перезавантаження
  }
}

/** Переклад фрази. vars підставляються замість {назва}: t('Привіт, {name}', { name }). */
export function t(text, vars) {
  let out = lang === 'en' && typeof EN[text] === 'string' ? EN[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
  return out;
}

/**
 * Слово після числа: tp(5, 'гра', 'гри', 'ігор') → «ігор» / «games».
 * В українській три форми, в англійській — дві (у словнику за першою формою: ['game', 'games']).
 */
export function tp(n, one, few, many) {
  if (lang === 'en') {
    const forms = Array.isArray(EN[one]) ? EN[one] : [one, one];
    return Math.abs(n) === 1 ? forms[0] : forms[1];
  }
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Перекладає статичну частину сторінки (index.html): елементи з атрибутом data-i18n.
 * Український оригінал запам'ятовується при першому проході, тож мову можна перемикати скільки завгодно.
 * data-i18n-attr="aria-label,title" — ще й ці атрибути.
 */
export function translateStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.dataset.i18nText ??= el.textContent.trim();
    el.textContent = t(el.dataset.i18nText);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const attr of el.dataset.i18nAttr.split(',')) {
      const key = `i18n${attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())}`;
      el.dataset[key] ??= el.getAttribute(attr) || '';
      el.setAttribute(attr, t(el.dataset[key]));
    }
  }
}
