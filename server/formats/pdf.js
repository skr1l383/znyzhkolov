// PDF без бібліотек: сторінки, текст з вбудованим шрифтом (кирилиця), прямокутники, лінії, JPEG-картинки.
// PDF — це набір пронумерованих «об'єктів» (сторінки, шрифти, картинки) і таблиця, де кожен із них лежить у файлі.
// Шрифт вбудовується як CIDFontType2 з кодуванням Identity-H: у тексті записуються номери гліфів,
// а таблиця ToUnicode дозволяє копіювати й шукати текст у переглядачі.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { TrueTypeFont } from './ttf.js';

export const A4 = { width: 595.28, height: 841.89 };

const num = (n) => (Math.round(n * 100) / 100).toString();
const hex4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();

/** Колір '#1f6fb2' → '0.12 0.44 0.7' */
function rgb(color) {
  const h = color.replace('#', '');
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
}

/** Текст для словника PDF (назва документа тощо) — у UTF-16 з позначкою порядку байтів. */
function pdfString(text) {
  const utf16 = Buffer.from(`﻿${text}`, 'utf16le').swap16();
  return `<${utf16.toString('hex').toUpperCase()}>`;
}

/** Розміри JPEG з його заголовка (маркер SOF). */
function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) return null;
    const marker = buf[p + 1];
    const len = buf.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), components: buf[p + 9] };
    }
    p += 2 + len;
  }
  return null;
}

class PdfPage {
  constructor(doc, width, height) {
    this.doc = doc;
    this.width = width;
    this.height = height;
    this.ops = [];
  }

  // Координати — від лівого верхнього кута (як у вебі); PDF рахує від нижнього, тож перевертаємо y
  #y(y) {
    return this.height - y;
  }

  text(str, x, y, { font = 'regular', size = 10, color = '#000000', align = 'left', maxWidth } = {}) {
    const f = this.doc.fonts[font];
    let s = String(str);
    if (maxWidth && f.ttf.width(s, size) > maxWidth) {
      while (s.length > 1 && f.ttf.width(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
      s = `${s.trimEnd()}…`;
    }
    const w = f.ttf.width(s, size);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${f.ref} ${num(size)} Tf ${rgb(color)} rg ${num(left)} ${num(this.#y(y))} Td <${this.doc.encode(font, s)}> Tj ET`);
    return w;
  }

  /** Розбиває текст на рядки за шириною; повертає масив рядків. */
  wrap(str, width, { font = 'regular', size = 10, maxLines = Infinity } = {}) {
    const f = this.doc.fonts[font].ttf;
    const lines = [];
    let line = '';
    for (const word of String(str).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (f.width(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`; // обріжеться трикрапкою при виводі
      return kept;
    }
    return lines;
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 } = {}) {
    const top = this.#y(y);
    const bottom = top - h;
    let path;
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2);
      const k = r * 0.5523; // кривими Безьє так малюють чверть кола
      path =
        `${num(x + r)} ${num(bottom)} m ${num(x + w - r)} ${num(bottom)} l ` +
        `${num(x + w - r + k)} ${num(bottom)} ${num(x + w)} ${num(bottom + r - k)} ${num(x + w)} ${num(bottom + r)} c ` +
        `${num(x + w)} ${num(top - r)} l ${num(x + w)} ${num(top - r + k)} ${num(x + w - r + k)} ${num(top)} ${num(x + w - r)} ${num(top)} c ` +
        `${num(x + r)} ${num(top)} l ${num(x + r - k)} ${num(top)} ${num(x)} ${num(top - r + k)} ${num(x)} ${num(top - r)} c ` +
        `${num(x)} ${num(bottom + r)} l ${num(x)} ${num(bottom + r - k)} ${num(x + r - k)} ${num(bottom)} ${num(x + r)} ${num(bottom)} c h`;
    } else {
      path = `${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`;
    }
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.ops.push(`q ${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${num(lineWidth)} w ` : ''}${path} ${paint} Q`);
  }

  line(x1, y1, x2, y2, { color = '#000000', width = 1 } = {}) {
    this.ops.push(`q ${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.#y(y1))} m ${num(x2)} ${num(this.#y(y2))} l S Q`);
  }

  image(key, x, y, w, h) {
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.#y(y + h))} cm /${key} Do Q`);
  }

  /** Обрізати все подальше малювання прямокутником із заокругленням (наприклад, обкладинку). */
  clip(x, y, w, h, draw) {
    this.ops.push('q');
    const top = this.#y(y);
    this.ops.push(`${num(x)} ${num(top - h)} ${num(w)} ${num(h)} re W n`);
    draw();
    this.ops.push('Q');
  }
}

export class PdfDocument {
  constructor({ title = '', author = '', lang = 'uk' } = {}) {
    this.meta = { title, author, lang };
    this.fonts = {};
    this.images = [];
    this.pages = [];
  }

  addFont(key, buffer, name) {
    this.fonts[key] = { ttf: new TrueTypeFont(buffer, name), name, used: new Map(), ref: `F${Object.keys(this.fonts).length + 1}` };
  }

  /** JPEG як є (PDF уміє його показувати без перекодування). Повертає ключ або null, якщо формат не підходить. */
  addJpeg(buffer) {
    const info = jpegInfo(buffer);
    if (!info || ![1, 3].includes(info.components)) return null;
    const key = `Im${this.images.length + 1}`;
    this.images.push({ key, buffer, ...info });
    return key;
  }

  addPage(width = A4.width, height = A4.height) {
    const page = new PdfPage(this, width, height);
    this.pages.push(page);
    return page;
  }

  /** Текст → номери гліфів у шістнадцятковому вигляді (і запам'ятовуємо, які гліфи знадобились). */
  encode(fontKey, text) {
    const f = this.fonts[fontKey];
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      let glyph = f.ttf.glyphFor(cp);
      if (!glyph && /\s/.test(ch)) glyph = f.ttf.glyphFor(32); // нерозривні пробіли тощо — як звичайний пробіл
      if (!f.used.has(glyph)) f.used.set(glyph, /\s/.test(ch) ? 32 : cp);
      out += hex4(glyph);
    }
    return out;
  }

  toBuffer() {
    const objects = []; // [номер] = вміст (Buffer або рядок)
    const reserve = () => objects.push(null);
    const set = (n, body) => (objects[n - 1] = body);
    const stream = (dict, data, { compress = true } = {}) => {
      const body = compress ? zlib.deflateSync(data) : data;
      return Buffer.concat([
        Buffer.from(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`, 'latin1'),
        body,
        Buffer.from('\nendstream', 'latin1'),
      ]);
    };

    const catalog = reserve();
    const pagesObj = reserve();

    // Шрифти: лише використані гліфи
    const fontRefs = {};
    for (const [key, f] of Object.entries(this.fonts)) {
      if (!f.used.size) continue;
      const scale = 1000 / f.ttf.unitsPerEm;
      const glyphs = [...f.used.keys()].sort((a, b) => a - b);
      // Позначка підмножини: шість великих літер перед назвою, як вимагає стандарт
      const tag = [...crypto.createHash('md5').update(glyphs.join(',') + f.name).digest()].slice(0, 6).map((b) => String.fromCharCode(65 + (b % 26))).join('');
      const baseFont = `${tag}+${f.name}`;

      const fontFile = reserve();
      const subset = f.ttf.subset(glyphs);
      set(fontFile, stream(`/Length1 ${subset.length}`, subset));

      const descriptor = reserve();
      set(
        descriptor,
        `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 32 /FontBBox [${f.ttf.bbox.map((v) => Math.round(v * scale)).join(' ')}]` +
          ` /ItalicAngle 0 /Ascent ${Math.round(f.ttf.ascent * scale)} /Descent ${Math.round(f.ttf.descent * scale)}` +
          ` /CapHeight ${Math.round(f.ttf.capHeight * scale)} /StemV 80 /FontFile2 ${fontFile} 0 R >>`
      );

      const cid = reserve();
      const widths = glyphs.map((g) => `${g} [${Math.round(f.ttf.advance(g) * scale)}]`).join(' ');
      set(
        cid,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>` +
          ` /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /W [${widths}] >>`
      );

      // ToUnicode: щоб текст з PDF можна було скопіювати й знайти пошуком
      const entries = glyphs.map((g) => {
        const u = Buffer.from(String.fromCodePoint(f.used.get(g)), 'utf16le').swap16().toString('hex').toUpperCase();
        return `<${hex4(g)}> <${u}>`;
      });
      let cmap =
        '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
        '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < entries.length; i += 100) {
        const chunk = entries.slice(i, i + 100);
        cmap += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`;
      }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const toUnicode = reserve();
      set(toUnicode, stream('', Buffer.from(cmap, 'latin1')));

      const type0 = reserve();
      set(
        type0,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`
      );
      fontRefs[f.ref] = type0;
    }

    const imageRefs = {};
    for (const img of this.images) {
      const n = reserve();
      set(
        n,
        stream(
          `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? 'DeviceGray' : 'DeviceRGB'}` +
            ' /BitsPerComponent 8 /Filter /DCTDecode',
          img.buffer,
          { compress: false }
        )
      );
      imageRefs[img.key] = n;
    }

    const resources =
      `<< /Font << ${Object.entries(fontRefs).map(([k, n]) => `/${k} ${n} 0 R`).join(' ')} >>` +
      ` /XObject << ${Object.entries(imageRefs).map(([k, n]) => `/${k} ${n} 0 R`).join(' ')} >> >>`;
    const pageRefs = this.pages.map((page) => {
      const content = reserve();
      set(content, stream('', Buffer.from(page.ops.join('\n'), 'latin1')));
      const n = reserve();
      set(
        n,
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources ${resources} /Contents ${content} 0 R >>`
      );
      return n;
    });
    set(pagesObj, `<< /Type /Pages /Kids [${pageRefs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
    set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R /Lang ${pdfString(this.meta.lang)} /ViewerPreferences << /DisplayDocTitle true >> >>`);
    const d = new Date();
    const stamp = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`;
    const info = reserve();
    set(info, `<< /Title ${pdfString(this.meta.title)} /Author ${pdfString(this.meta.author)} /Producer ${pdfString('Знижколов')} /CreationDate (${stamp}) >>`);

    // Збираємо файл і таблицю зміщень (xref): де саме лежить кожен об'єкт
    const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const chunk = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
        Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      parts.push(chunk);
      offset += chunk.length;
    });
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}
