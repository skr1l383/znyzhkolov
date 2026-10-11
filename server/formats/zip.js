// Мінімальний ZIP: запис і читання архівів. Потрібен для Excel, бо файл .xlsx —
// це ZIP-архів з кількома XML-файлами всередині.
// Стиснення (deflate) і контрольна сума CRC-32 беруться з вбудованого модуля node:zlib.
import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

/** Фіксована дата всередині архіву (1 січня 2020) — архів не залежить від часу створення. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/** files: [{ name, data: Buffer | string }] → Buffer з ZIP-архівом. */
export function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // версія для розпакування
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8); // метод: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Buffer з ZIP-архівом → Map «ім'я файлу» → Buffer.
 * Читаємо центральний каталог у кінці архіву: там точні розміри й адреси всіх файлів.
 */
export function readZip(buf, { maxTotal = 20 * 1024 * 1024 } = {}) {
  const fail = () => new Error('Файл пошкоджений або це не ZIP-архів');
  // Кінцевий запис шукаємо з кінця: після нього може бути коментар до 64 КБ
  let endAt = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === END_SIG) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw fail();

  const count = buf.readUInt16LE(endAt + 10);
  let p = buf.readUInt32LE(endAt + 16);
  const files = new Map();
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) throw fail();
    const method = buf.readUInt16LE(p + 10);
    const packedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // Захист від «ZIP-бомби»: маленький архів, що розпаковується в гігабайти
    total += size;
    if (total > maxTotal) throw new Error('Архів розпаковується в надто великий обсяг даних');

    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOCAL_SIG) throw fail();
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const packed = buf.subarray(dataAt, dataAt + packedSize);
    if (method === 0) files.set(name, Buffer.from(packed));
    else if (method === 8) files.set(name, zlib.inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) }));
    else throw new Error('Непідтримуваний спосіб стиснення в архіві');
  }
  return files;
}
