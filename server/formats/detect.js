// Визначення справжнього типу файлу за його першими байтами («магічними числами»).
// Розширенню в імені не віримо: file.exe легко перейменувати на photo.png.

const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);

/** Картинка для аватара: { ext, type } або null, якщо формат не підтримується. */
export function detectImage(buf) {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

/** Таблиця для імпорту: 'xlsx', 'csv' або null. Для старого .xls і PDF повертаємо окрему позначку. */
export function detectTable(buf) {
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'xlsx'; // ZIP-архів
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) return 'xls'; // старий формат Excel 97–2003
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (detectImage(buf)) return 'image';
  // Текстовий файл не містить нульових байтів (перевіряємо перші 8 КБ)
  if (!buf.subarray(0, 8192).includes(0)) return 'csv';
  return null;
}
