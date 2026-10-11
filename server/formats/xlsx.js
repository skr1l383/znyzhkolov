// Excel (.xlsx) без бібліотек. Файл .xlsx — це ZIP-архів з XML-файлами за стандартом Office Open XML:
//   [Content_Types].xml        — які типи файлів лежать в архіві
//   xl/workbook.xml            — список аркушів
//   xl/worksheets/sheet1.xml   — самі клітинки
//   xl/sharedStrings.xml       — спільні рядки (Excel зберігає текст окремо, а в клітинці лише номер)
//   xl/styles.xml              — оформлення (у нас: жирний заголовок)
import { createZip, readZip } from './zip.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const escapeXml = (s) =>
  String(s)
    // символи, заборонені в XML 1.0, викидаємо
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const unescapeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });

/** 0 → A, 25 → Z, 26 → AA */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** "AB12" → 27 (номер стовпця з нуля) */
function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() || 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/**
 * rows: масив рядків, перший — заголовок. Значення: рядок, число, true/false або null.
 * widths: ширина стовпців у символах.
 */
export function toXlsx(rows, { sheetName = 'Аркуш1', widths = [] } = {}) {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value == null || value === '') return '';
          const ref = `${columnName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : '';
          if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
          if (typeof value === 'boolean') return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const sheet =
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">` +
    // Закріплений заголовок: при прокручуванні перший рядок лишається на місці
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;

  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      data:
        `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

/** Увесь текст з елементів <t> усередині фрагмента (рядок може бути розбитий на шматки з різним оформленням). */
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

/** Перший аркуш файлу .xlsx → масив рядків (кожен — масив значень-рядків). */
export function parseXlsx(buf) {
  const files = readZip(buf);
  const read = (name) => files.get(name)?.toString('utf8');
  if (!read('xl/workbook.xml')) throw new Error('Це не файл Excel (.xlsx)');

  // Шлях до першого аркуша беремо зі зв'язків книги; зазвичай це xl/worksheets/sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheetRel = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(read('xl/workbook.xml'))?.[1];
  const rels = read('xl/_rels/workbook.xml.rels') || '';
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (m[0].includes(`Id="${firstSheetRel}"`)) {
      const target = /Target="([^"]+)"/.exec(m[0])?.[1];
      if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error('У файлі Excel не знайдено аркуша з даними');

  const shared = [...(read('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const c of (rowMatch[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (type === 'b') value = raw === '1' ? 'так' : 'ні';
      else if (raw != null) value = unescapeXml(raw);
      row[ref ? columnIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (v) => v ?? ''));
  }
  return rows;
}
