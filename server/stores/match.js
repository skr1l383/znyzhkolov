// Пошук однієї й тієї самої гри в різних магазинах.
// Назви часто відрізняються («The Witcher 3: Wild Hunt» та «The Witcher 3: Wild Hunt - Complete Edition»),
// тому назви нормалізуються і порівнюються за словами.

const EDITION_WORDS = new Set([
  'edition', 'goty', 'game', 'of', 'the', 'year', 'complete', 'definitive', 'deluxe', 'standard',
  'enhanced', 'remastered', 'ultimate', 'gold', 'premium', 'directors', 'director', 'cut', 'collection',
]);

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const words = (t) => normalizeTitle(t).split(' ').filter(Boolean);
const coreWords = (t) => words(t).filter((w) => !EDITION_WORDS.has(w));

/** Схожість назв від 0 до 1. */
export function titleScore(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ca = coreWords(a).join(' ');
  const cb = coreWords(b).join(' ');
  if (ca && ca === cb) return 0.9;

  // Числа в назві (Hades vs Hades II, Witcher 2 vs Witcher 3) мають збігатися
  const numsA = words(a).filter((w) => /^(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(w)).join(',');
  const numsB = words(b).filter((w) => /^(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(w)).join(',');
  if (numsA !== numsB) return 0;

  const sa = new Set(coreWords(a));
  const sb = new Set(coreWords(b));
  const common = [...sa].filter((w) => sb.has(w)).length;
  const union = new Set([...sa, ...sb]).size;
  return union ? Math.round((common / union) * 0.8 * 100) / 100 : 0;
}

/** Повертає кандидатів, відсортованих за схожістю, лише достатньо схожих. */
export function rankMatches(title, candidates, minScore = 0.5) {
  return candidates
    .map((c) => ({ ...c, score: titleScore(title, c.title) }))
    .filter((c) => c.score >= minScore)
    .sort((x, y) => y.score - x.score);
}
