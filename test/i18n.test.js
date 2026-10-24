// Перевірка перекладу: кожна українська фраза інтерфейсу має англійський відповідник.
// Фрази збираються прямо з коду: рядки в public/js, тексти з data-i18n в index.html
// і повідомлення сервера, які браузер показує користувачу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EN } from '../public/js/i18n-en.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CYR = /[а-яіїєґ]/i;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : rel.endsWith('.js') ? [rel] : [];
  });
}

/**
 * Розбирає JS на рядкові літерали. Повертає { strings, texts }: strings — рядки в лапках
 * і шаблони без ${}, texts — шматки тексту шаблонів із ${} (там українського бути не повинно,
 * бо такий текст пройшов би повз t()).
 */
function literals(src) {
  const strings = [];
  const texts = [];
  let i = 0;
  let prev = ''; // останній значущий символ коду — щоб відрізнити регулярний вираз від ділення

  const quoted = (q) => {
    let s = '';
    for (i++; i < src.length && src[i] !== q; i++) s += src[i] === '\\' ? src[++i] : src[i];
    i++;
    return s;
  };
  const regex = () => {
    let inClass = false;
    for (i++; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') i++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
    }
    i++;
  };
  const template = () => {
    const parts = [''];
    let plain = true;
    for (i++; i < src.length && src[i] !== '`'; ) {
      if (src[i] === '\\') {
        parts[parts.length - 1] += src[i + 1];
        i += 2;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        plain = false;
        i += 2;
        code(true);
        parts.push('');
      } else parts[parts.length - 1] += src[i++];
    }
    i++;
    if (plain) strings.push(parts[0]);
    else texts.push(...parts);
  };
  function code(inside) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        i = src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
      } else if (c === '/' && src[i + 1] === '*') {
        i = src.indexOf('*/', i) + 2;
      } else if (c === '/' && (!prev || '(,=:[!&|?{};+'.includes(prev))) {
        regex();
        prev = 'x';
      } else if (c === "'" || c === '"') {
        strings.push(quoted(c));
        prev = 'x';
      } else if (c === '`') {
        template();
        prev = 'x';
      } else {
        if (c === '{') depth++;
        if (c === '}') {
          if (inside && depth === 0) {
            i++;
            prev = 'x';
            return;
          }
          depth--;
        }
        if (!/\s/.test(c)) prev = c;
        i++;
      }
    }
  }
  code(false);
  return { strings, texts };
}

function clientPhrases() {
  const phrases = new Map(); // фраза → файл
  const plurals = new Set();
  const loose = []; // український текст у шаблонах повз t()
  const otherForms = new Set(); // «гри», «ігор» — для англійської вистачає ключа з першою формою
  for (const rel of walk('public/js').filter((f) => !/\/i18n(-en)?\.js$/.test(f))) {
    // Уже україномовні блоки, які показуються лише українською: переклад підсумків відгуків Steam
    // і повний текст сторінки «Конфіденційність» (англійська версія — окремим блоком поруч)
    const src = read(rel)
      .replace(/const REVIEWS_UK = \{[\s\S]*?\n\};/, '')
      .replace(/const UK = \(\) => html`[\s\S]*?`;/, '');
    for (const m of src.matchAll(/\btp\([^,]+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)) {
      plurals.add(m[1]);
      otherForms.add(m[2]).add(m[3]);
    }
    const { strings, texts } = literals(src);
    for (const s of strings) if (CYR.test(s) && !phrases.has(s) && !otherForms.has(s)) phrases.set(s, rel);
    for (const s of texts) if (CYR.test(s)) loose.push(`${rel}: ${s.trim().slice(0, 80)}`);
  }
  for (const s of otherForms) if (!plurals.has(s)) phrases.delete(s);
  const index = read('public/index.html');
  for (const m of index.matchAll(/<[a-z0-9]+[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]+)</g)) phrases.set(m[1].trim(), 'index.html');
  for (const m of index.matchAll(/<[a-z0-9]+([^>]*)\sdata-i18n-attr="([^"]+)"([^>]*)>/g)) {
    for (const attr of m[2].split(/[\s,]+/)) {
      const v = `${m[1]} ${m[3]}`.match(new RegExp(`\\s${attr}="([^"]*)"`));
      if (v) phrases.set(v[1], 'index.html');
    }
  }
  return { phrases, plurals, loose };
}

/** Повідомлення сервера, які доходять до користувача і перекладаються в браузері. */
function serverPhrases() {
  const phrases = new Map();
  const STR = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
  const patterns = [
    String.raw`(?:HttpError|templateError)\(\s*\d+\s*,\s*(?:[^'"?]+\?\s*)?(?:${STR})`, // помилки
    String.raw`(?:fieldError)\([^,]+,\s*(?:${STR})`,
    String.raw`v\.\w+\([^)]*label:\s*(?:${STR})`, // назви полів у повідомленнях перевірки
    String.raw`reason:\s*(?:${STR})`, // причини, чому рядок імпорту пропущено
    String.raw`reason:[^'"\n]*:\s*(?:${STR})`, // …і запасна причина після «умова ? … :»
    String.raw`answer = \{[^}]*message:\s*(?:${STR})`,
    String.raw`defineJob\('\w+',\s*\{\s*title:\s*(?:${STR})`, // назви задач в адмін-панелі
  ];
  for (const rel of [...walk('server')]) {
    const src = read(rel);
    for (const p of patterns) {
      for (const m of src.matchAll(new RegExp(p, 'g'))) {
        const s = (m[1] ?? m[2]).replace(/\\(.)/g, '$1');
        if (CYR.test(s)) phrases.set(s, rel);
      }
    }
    // Обидві гілки «умова ? 'А' : 'Б'» у templateError
    for (const m of src.matchAll(/templateError\(\s*\d+,\s*[^?]+\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
      phrases.set(m[1], rel).set(m[2], rel);
    }
  }
  return phrases;
}

const client = clientPhrases();
const server = serverPhrases();
const all = new Map([...client.phrases, ...server]);

test('Переклад: кожна фраза має англійський відповідник', () => {
  const missing = [...all].filter(([k]) => !(k in EN)).map(([k, where]) => `${where}: ${k}`);
  assert.deepEqual(missing, [], `Без перекладу (${missing.length}):\n${missing.join('\n')}`);
});

test('Переклад: увесь текст інтерфейсу проходить через t()', () => {
  assert.deepEqual(client.loose, []);
});

test('Переклад: слова після числа мають дві англійські форми', () => {
  const bad = [...client.plurals].filter((k) => !Array.isArray(EN[k]) || EN[k].length !== 2);
  assert.deepEqual(bad, []);
});

test('Переклад: підстановки {…} однакові в оригіналі й перекладі', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(EN)
    .filter(([k, v]) => typeof v === 'string' && names(k) !== names(v))
    .map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(bad, []);
});

test('Переклад: повідомлення сервера зі значеннями складаються через templateError', () => {
  // `Текст ${значення}` у HttpError не перекласти словником — для такого є шаблон із {назвами}
  const bad = walk('server').flatMap((rel) =>
    [...read(rel).matchAll(/HttpError\(\s*\d+\s*,\s*`([^`]*)`/g)].filter((m) => CYR.test(m[1])).map((m) => `${rel}: ${m[1]}`)
  );
  assert.deepEqual(bad, []);
});

test('Переклад: у словнику немає зайвих фраз', () => {
  const stale = Object.keys(EN).filter((k) => !all.has(k) && !client.plurals.has(k));
  assert.deepEqual(stale, []);
});
