// Шрифт TrueType (.ttf): читання метрик і таблиці символів, а також «підмножина» —
// копія шрифту лише з тими гліфами, що є в документі. Потрібно для PDF з кирилицею.
// Номери гліфів у підмножині ті самі, що в повному шрифті: зайві гліфи просто стають порожніми.

const tag = (buf, off) => buf.toString('latin1', off, off + 4);

export class TrueTypeFont {
  constructor(buffer, name) {
    this.buf = buffer;
    this.name = name;
    this.tables = {};
    const numTables = buffer.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      this.tables[tag(buffer, rec)] = { offset: buffer.readUInt32BE(rec + 8), length: buffer.readUInt32BE(rec + 12) };
    }
    for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'loca', 'glyf']) {
      if (!this.tables[t]) throw new Error(`У шрифті немає таблиці ${t}`);
    }
    const head = this.tables.head.offset;
    this.unitsPerEm = buffer.readUInt16BE(head + 18);
    this.bbox = [0, 2, 4, 6].map((d) => buffer.readInt16BE(head + 36 + d));
    this.longLoca = buffer.readInt16BE(head + 50) === 1;
    const hhea = this.tables.hhea.offset;
    this.ascent = buffer.readInt16BE(hhea + 4);
    this.descent = buffer.readInt16BE(hhea + 6);
    this.numHMetrics = buffer.readUInt16BE(hhea + 34);
    this.numGlyphs = buffer.readUInt16BE(this.tables.maxp.offset + 4);
    const os2 = this.tables['OS/2'];
    this.capHeight = os2 && os2.length >= 90 ? buffer.readInt16BE(os2.offset + 88) : this.ascent;
    this.cmap = this.#readCmap();
  }

  /** Таблиця «символ Юнікоду → номер гліфа» (формати 4 і 12). */
  #readCmap() {
    const b = this.buf;
    const base = this.tables.cmap.offset;
    const count = b.readUInt16BE(base + 2);
    let best = null;
    for (let i = 0; i < count; i++) {
      const platform = b.readUInt16BE(base + 4 + i * 8);
      const encoding = b.readUInt16BE(base + 6 + i * 8);
      const offset = base + b.readUInt32BE(base + 8 + i * 8);
      const format = b.readUInt16BE(offset);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (unicode && (format === 12 || (format === 4 && best?.format !== 12))) best = { format, offset };
    }
    if (!best) throw new Error('У шрифті немає таблиці символів Юнікоду');
    const map = new Map();
    const o = best.offset;
    if (best.format === 12) {
      const groups = b.readUInt32BE(o + 12);
      for (let g = 0; g < groups; g++) {
        const p = o + 16 + g * 12;
        const start = b.readUInt32BE(p);
        const end = b.readUInt32BE(p + 4);
        const glyph = b.readUInt32BE(p + 8);
        for (let c = start; c <= end; c++) map.set(c, glyph + c - start);
      }
    } else {
      const segX2 = b.readUInt16BE(o + 6);
      const ends = o + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = b.readUInt16BE(ends + s);
        const start = b.readUInt16BE(starts + s);
        const delta = b.readInt16BE(deltas + s);
        const rangeOffset = b.readUInt16BE(ranges + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            glyph = b.readUInt16BE(ranges + s + rangeOffset + (c - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) map.set(c, glyph);
        }
      }
    }
    return map;
  }

  glyphFor(codePoint) {
    return this.cmap.get(codePoint) ?? 0; // 0 — «порожній квадрат» для невідомих символів
  }

  /** Ширина гліфа в одиницях шрифту. */
  advance(glyph) {
    const hmtx = this.tables.hmtx.offset;
    const i = Math.min(glyph, this.numHMetrics - 1);
    return this.buf.readUInt16BE(hmtx + i * 4);
  }

  /** Ширина тексту в пунктах для заданого кегля. */
  width(text, size) {
    let units = 0;
    for (const ch of text) units += this.advance(this.glyphFor(ch.codePointAt(0)));
    return (units / this.unitsPerEm) * size;
  }

  #glyphRange(glyph) {
    const loca = this.tables.loca.offset;
    const b = this.buf;
    return this.longLoca
      ? [b.readUInt32BE(loca + glyph * 4), b.readUInt32BE(loca + glyph * 4 + 4)]
      : [b.readUInt16BE(loca + glyph * 2) * 2, b.readUInt16BE(loca + glyph * 2 + 2) * 2];
  }

  /** Складені гліфи (наприклад, «ї» = «і» + дві крапки) посилаються на інші — їх теж треба зберегти. */
  #components(glyph) {
    const [start, end] = this.#glyphRange(glyph);
    if (end <= start) return [];
    const b = this.buf;
    const p0 = this.tables.glyf.offset + start;
    if (b.readInt16BE(p0) >= 0) return []; // простий гліф
    const result = [];
    let p = p0 + 10;
    for (;;) {
      const flags = b.readUInt16BE(p);
      result.push(b.readUInt16BE(p + 2));
      p += 4 + (flags & 0x0001 ? 4 : 2);
      if (flags & 0x0008) p += 2;
      else if (flags & 0x0040) p += 4;
      else if (flags & 0x0080) p += 8;
      if (!(flags & 0x0020)) break;
    }
    return result;
  }

  /** Новий файл шрифту, у якому залишено лише потрібні гліфи (номери не змінюються). */
  subset(glyphs) {
    const keep = new Set([0, ...glyphs]);
    const queue = [...keep];
    while (queue.length) {
      for (const c of this.#components(queue.pop())) {
        if (!keep.has(c)) {
          keep.add(c);
          queue.push(c);
        }
      }
    }
    const glyfParts = [];
    const loca = Buffer.alloc((this.numGlyphs + 1) * 4);
    let offset = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      loca.writeUInt32BE(offset, g * 4);
      if (keep.has(g)) {
        const [start, end] = this.#glyphRange(g);
        const data = this.buf.subarray(this.tables.glyf.offset + start, this.tables.glyf.offset + end);
        const padded = Buffer.alloc((data.length + 3) & ~3);
        data.copy(padded);
        glyfParts.push(padded);
        offset += padded.length;
      }
    }
    loca.writeUInt32BE(offset, this.numGlyphs * 4);

    const copy = (t) => Buffer.from(this.buf.subarray(this.tables[t].offset, this.tables[t].offset + this.tables[t].length));
    const head = copy('head');
    head.writeUInt32BE(0, 8); // checkSumAdjustment перерахуємо нижче
    head.writeInt16BE(1, 50); // «довга» таблиця loca
    const tables = { head, hhea: copy('hhea'), maxp: copy('maxp'), hmtx: copy('hmtx'), loca, glyf: Buffer.concat(glyfParts) };
    for (const t of ['cvt ', 'fpgm', 'prep']) if (this.tables[t]) tables[t] = copy(t); // інструкції чіткості дрібного тексту
    return buildFont(tables);
  }
}

function checksum(buf) {
  let sum = 0;
  const padded = buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function buildFont(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const header = Buffer.alloc(12 + n * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(Math.log2(pow), 8);
  header.writeUInt16BE(n * 16 - pow * 16, 10);
  let offset = header.length;
  const bodies = [];
  tags.forEach((t, i) => {
    const data = tables[t];
    const rec = 12 + i * 16;
    header.write(t, rec, 'latin1');
    header.writeUInt32BE(checksum(data), rec + 4);
    header.writeUInt32BE(offset, rec + 8);
    header.writeUInt32BE(data.length, rec + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const font = Buffer.concat([header, ...bodies]);
  // Контрольна сума всього файлу записується в таблицю head
  const headOffset = header.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}
