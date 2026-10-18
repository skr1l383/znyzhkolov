// Розпізнавання QR-кодів з камери або з фото.
// Якщо браузер має вбудований BarcodeDetector (Chrome на Android, macOS) — використовуємо його,
// інакше (наприклад, Chrome на Windows) — бібліотеку jsQR, яка завантажується лише за потреби.

let jsQRLoading = null;
function loadJsQR() {
  jsQRLoading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/jsQR.js';
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => reject(new Error('Не вдалося завантажити розпізнавач QR-кодів'));
    document.head.append(script);
  });
  return jsQRLoading;
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** Створює функцію «кадр → { text, corners } або null». */
async function createDecoder() {
  const native = await nativeDetector();
  if (native) {
    return async (canvas) => {
      const [code] = await native.detect(canvas);
      return code ? { text: code.rawValue, corners: code.cornerPoints } : null;
    };
  }
  const jsQR = await loadJsQR();
  return async (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!code) return null;
    const l = code.location;
    return { text: code.data, corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] };
  };
}

/** QR з фото (файл від користувача). Велике фото зменшуємо — так розпізнавання швидше і надійніше. */
export async function decodeImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const decode = await createDecoder();
  const result = await decode(canvas);
  if (!result) throw new Error('На фото не знайдено QR-коду. Спробуй чіткіше фото, де код займає більшу частину кадру');
  return result.text;
}

/**
 * Сканування камерою: відео з камери в video, поверх — canvas з рамкою навколо знайденого коду.
 * Повертає функцію зупинки. onResult(text) викликається один раз.
 */
export async function startCameraScan(video, overlay, { onResult, onError }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Камера недоступна: браузер не підтримує доступ до камери або сайт відкрито не через https');
  }
  let stream;
  try {
    // Задня камера телефона, якщо є; на ноутбуці — вебкамера
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (err) {
    throw new Error(
      err.name === 'NotAllowedError'
        ? 'Доступ до камери заборонено. Дозволь його в налаштуваннях браузера (значок камери в адресному рядку)'
        : err.name === 'NotFoundError'
          ? 'Камеру не знайдено'
          : `Не вдалося увімкнути камеру: ${err.message}`
    );
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});

  const decode = await createDecoder();
  const frame = document.createElement('canvas');
  let stopped = false;
  let timer = null;

  const drawCorners = (corners) => {
    const ctx = overlay.getContext('2d');
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!corners) return;
    ctx.lineWidth = Math.max(4, overlay.width / 120);
    ctx.strokeStyle = '#f5a53f';
    ctx.fillStyle = 'rgb(245 165 63 / 0.18)';
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frame.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0);
      try {
        const result = await decode(frame);
        drawCorners(result?.corners);
        if (result?.text && !stopped) {
          stop();
          onResult(result.text);
          return;
        }
      } catch (err) {
        onError?.(err);
      }
    }
    timer = setTimeout(tick, 200); // 5 кадрів на секунду досить і не гріє телефон
  };

  function stop() {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  tick();
  return stop;
}

/** Якщо QR містить посилання на список у Знижколові — повертає ключ списку. */
export function sharedTokenFrom(text) {
  try {
    const url = new URL(text, location.origin);
    const hash = url.hash.replace(/^#\/?/, '');
    const [route, query] = hash.split('?');
    const token = new URLSearchParams(query || '').get('token');
    return route === 'shared' && token && /^[\w-]{10,40}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}
