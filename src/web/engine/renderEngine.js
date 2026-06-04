// renderEngine — rasterize + text-extract PDFs with pdfjs-dist, 100% offline.
// In the Android WebView we have a real DOM canvas, so (unlike the Electron
// build which needed a hidden raster window + nativeImage) we render straight
// to <canvas> and read pixels here. The pdf.js worker is bundled in app assets
// and pointed at a local file URL — nothing is ever fetched.

import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

let workerConfigured = false;
function ensureWorker() {
  if (workerConfigured) return;
  // The worker file is copied into the web root by scripts/copy-assets.mjs and
  // shipped inside the APK. Capacitor serves assets from this origin, so this
  // resolves to a local URL — no network.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
  workerConfigured = true;
}

function asBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** Open a pdfjs document from bytes. Caller must destroy it. */
async function open(bytes) {
  ensureWorker();
  return pdfjs.getDocument({
    data: asBytes(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
}

/** Extract all text from a PDF, page by page. Returns {pages:[string], text}. */
export async function extractText(bytes) {
  const doc = await open(bytes);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let last = null;
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      if (last != null && Math.abs(y - last) > 2) {
        lines.push(line.trimEnd());
        line = '';
      }
      line += item.str + (item.hasEOL ? '\n' : ' ');
      last = y;
    }
    if (line.trim()) lines.push(line.trimEnd());
    pages.push(lines.join('\n'));
  }
  await doc.destroy();
  return { pages, text: pages.join('\n\n') };
}

/** Page count + per-page viewport sizes at scale 1. */
export async function pageGeometry(bytes) {
  const doc = await open(bytes);
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  const n = doc.numPages;
  await doc.destroy();
  return { pageCount: n, sizes };
}

/** Encode a canvas to PNG or JPG bytes (Uint8Array). */
function canvasToBytes(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas encode failed.'));
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
      },
      mime,
      quality
    );
  });
}

/**
 * Rasterize selected pages to encoded image bytes.
 * Returns [{ index, width, height, bytes }].
 * opts: { scale, format:'png'|'jpg', quality(0..1), pages:[0-based], onProgress }
 */
export async function rasterizePages(bytes, opts = {}) {
  const { scale = 2, format = 'png', quality = 0.9, pages = null, onProgress } = opts;
  const doc = await open(bytes);
  const want =
    pages && pages.length
      ? pages.map((p) => p + 1).filter((n) => n >= 1 && n <= doc.numPages)
      : Array.from({ length: doc.numPages }, (_, i) => i + 1);

  const out = [];
  for (let k = 0; k < want.length; k++) {
    const pageNum = want[k];
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // White-fill so transparent PDFs flatten to a printable page.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const encoded = await canvasToBytes(canvas, format, quality);
    out.push({ index: pageNum - 1, width: canvas.width, height: canvas.height, bytes: encoded });
    canvas.width = 0;
    canvas.height = 0;
    if (onProgress) onProgress((k + 1) / want.length);
  }
  await doc.destroy();
  return out;
}

/** Rasterize one page to a data URL (for the viewer). */
export async function renderPageDataUrl(bytes, pageIndex, scale = 1.6) {
  const imgs = await rasterizePages(bytes, { scale, format: 'png', pages: [pageIndex] });
  if (!imgs.length) return null;
  const p = imgs[0];
  let bin = '';
  const u8 = p.bytes;
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return { dataUrl: 'data:image/png;base64,' + btoa(bin), width: p.width, height: p.height };
}
