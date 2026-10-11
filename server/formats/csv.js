// CSV: запис і читання. Українська версія Excel очікує крапку з комою як роздільник
// і BOM на початку, інакше кирилиця показується «кракозябрами».

const BOM = '﻿';

function cell(value) {
  if (value == null) return '';
  const s = typeof value === 'boolean' ? (value ? 'так' : 'ні') : String(value);
  return /[";\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, { separator = ';' } = {}) {
  return BOM + rows.map((row) => row.map(cell).join(separator)).join('\r\n') + '\r\n';
}

/** Роздільник визначаємо за першим рядком: що трапляється частіше поза лапками. */
function detectSeparator(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const counts = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** Текст CSV → масив рядків. Підтримує лапки, "" всередині лапок і переноси рядків у клітинці. */
export function parseCsv(text) {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const sep = detectSeparator(src);
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"' && value === '') quoted = true;
    else if (ch === sep) {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  if (value !== '' || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/**
 * Байти файлу → текст. Excel часто зберігає CSV у кодуванні Windows-1251,
 * тож якщо це не коректний UTF-8, пробуємо його.
 */
export function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}
