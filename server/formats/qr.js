// QR-код без бібліотек, за стандартом ISO/IEC 18004.
// Кроки: текст → байти → біти з заголовком → кодові слова → коди Ріда — Соломона (виправлення помилок)
// → розкладання по матриці разом зі службовими візерунками → маска з найменшим «штрафом».
// Перевірка: автотест розпізнає згенеровані коди сторонньою бібліотекою jsQR.

// Рівні виправлення помилок: скільки відсотків пошкоджень витримує код (L 7%, M 15%, Q 25%, H 30%)
const LEVELS = { L: { index: 0, bits: 1 }, M: { index: 1, bits: 0 }, Q: { index: 2, bits: 3 }, H: { index: 3, bits: 2 } };

// Таблиці стандарту для версій 1–40: кодових слів виправлення на блок і кількість блоків
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

/** Скільки модулів матриці лишається під дані (без службових візерунків). */
function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver, lvl) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[lvl][ver] * ECC_BLOCKS[lvl][ver];

// ---------- Коди Ріда — Соломона в полі GF(256) ----------

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// ---------- Матриця ----------

class Matrix {
  constructor(ver) {
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  set(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFunctionPatterns(m, ver, lvl) {
  const { size } = m;
  // Лінії синхронізації (через один модуль)
  for (let i = 0; i < size; i++) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  // Три великі «квадрати» в кутах — за ними сканер знаходить код
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) m.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Малі вирівнювальні квадрати (з версії 2)
  const pos = alignmentPositions(ver, size);
  const last = pos.length - 1;
  pos.forEach((y, i) =>
    pos.forEach((x, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    })
  );
  drawFormatBits(m, lvl, 0); // тимчасово, щоб позначити ці місця службовими
  // Номер версії (з версії 7)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.set(a, b, bit(bits, i));
      m.set(b, a, bit(bits, i));
    }
  }
}

/** Рівень виправлення і номер маски, захищені власним кодом БЧХ, — у двох копіях біля кутів. */
function drawFormatBits(m, lvl, mask) {
  const data = (LEVELS[lvl].bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size } = m;
  for (let i = 0; i <= 5; i++) m.set(8, i, bit(bits, i));
  m.set(8, 7, bit(bits, 6));
  m.set(8, 8, bit(bits, 7));
  m.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) m.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) m.set(8, size - 15 + i, bit(bits, i));
  m.set(8, size - 8, true); // завжди темний модуль
}

/** Розкладає байти змійкою знизу вгору по два стовпці, оминаючи службові модулі. */
function drawCodewords(m, data) {
  const { size } = m;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // стовпець 6 — лінія синхронізації
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!m.isFunction[y][x] && i < data.length * 8) {
          m.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, mask) {
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (!m.isFunction[y][x] && MASKS[mask](x, y)) m.modules[y][x] = !m.modules[y][x];
}

/**
 * «Штраф» за візерунки, що заважають сканеру: довгі однакові ряди, суцільні квадрати 2×2,
 * схожість на кутові квадрати і перекіс між темними й світлими модулями. Обирається маска з найменшим.
 */
function penalty(m) {
  const { size, modules } = m;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const s = line.map((d) => (d ? '1' : '0')).join('');
    for (const p of ['10111010000', '00001011101']) for (let k = s.indexOf(p); k !== -1; k = s.indexOf(p, k + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

/**
 * Текст → матриця QR (масив рядків з true для темних модулів).
 * level: L, M, Q або H. Версія (розмір) підбирається найменша, у яку вміщається текст.
 */
export function qrMatrix(text, { level = 'M' } = {}) {
  if (!LEVELS[level]) throw new Error(`Невідомий рівень виправлення: ${level}`);
  const lvl = LEVELS[level].index;
  const bytes = [...Buffer.from(String(text), 'utf8')];

  let ver = 1;
  for (; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver, lvl) * 8) break;
  }
  if (ver > 40) throw new Error('Текст задовгий для QR-коду');

  // Біти: режим «байти» (0100), довжина, самі байти, кінець і заповнювачі 0xEC/0x11
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCodewords(ver, lvl) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Ділимо на блоки, до кожного — коди виправлення, потім перемежовуємо блоки
  const numBlocks = ECC_BLOCKS[lvl][ver];
  const eccLen = ECC_PER_BLOCK[lvl][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(b[i]);
    });
  }

  // Пробуємо всі 8 масок і залишаємо найкращу
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = new Matrix(ver);
    drawFunctionPatterns(m, ver, level);
    drawCodewords(m, codewords);
    applyMask(m, mask);
    drawFormatBits(m, level, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score };
  }
  return best.m.modules;
}

/** Матриця → SVG. margin — «тиха зона» навколо коду (за стандартом не менше 4 модулів). */
export function qrSvg(text, { level = 'M', margin = 4, dark = '#0c111d', light = '#ffffff' } = {}) {
  const modules = qrMatrix(text, { level });
  const size = modules.length + margin * 2;
  let path = '';
  modules.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) path += `M${x + margin},${y + margin}h1v1h-1z`;
    })
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
  );
}
