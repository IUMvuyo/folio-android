// bridge.js — the in-WebView replacement for the Electron preload/IPC layer.
//
// The Electron build exposed a `window.folio` surface backed by a privileged
// main process (dialogs, fs, nativeImage, printToPDF). On Android there is no
// main process: the engines run right here in the WebView, and file I/O goes
// through Capacitor plugins:
//   • import  → @capawesome/capacitor-file-picker (system document picker)
//   • export  → @capacitor/filesystem (write to app Documents) + @capacitor/share
//
// Privacy: the engines make ZERO network calls (pdf-lib / pdfjs / tesseract are
// pointed at bundled local assets). The only "external" surface is the OS file
// picker / share sheet, which is local IPC, never the network.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Share } from '@capacitor/share';

import * as pdf from './engine/pdfEngine.js';
import * as render from './engine/renderEngine.js';
import * as ocr from './engine/ocrEngine.js';
import * as office from './engine/officeEngine.js';
import * as xml from './engine/xmlEngine.js';
import * as xps from './engine/xpsEngine.js';

const isNative = Capacitor.isNativePlatform();

// ── byte helpers ─────────────────────────────────────────────────────────────

function toU8(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x && x.buffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(x);
}

function u8ToBase64(u8) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToU8(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function dataUrlToU8(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return base64ToU8(dataUrl.slice(comma + 1));
}

function mimeFor(kind) {
  return {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xml: 'application/xml',
    xps: 'application/vnd.ms-xpsdocument',
  }[kind] || 'application/octet-stream';
}

// ── import (file picker) ─────────────────────────────────────────────────────
// Returns [{ name, bytes }]. On web (dev) falls back to a hidden <input>.

async function pickFiles({ types, multi = false } = {}) {
  if (isNative) {
    // NOTE: @capawesome/capacitor-file-picker IGNORES `types` when `limit` is
    // set. So for single-select we omit `limit` (default = one file) to keep the
    // type filter; for multi-select we pass `limit: 0` (unlimited) and accept
    // that the picker shows all files. readData:true returns base64 inline.
    const opts = { types: types || undefined, readData: true };
    if (multi) opts.limit = 0;
    const res = await FilePicker.pickFiles(opts);
    if (!res || !res.files || !res.files.length) return null;
    return res.files.map((f) => ({
      name: f.name || 'file',
      bytes: base64ToU8(f.data),
    }));
  }
  // Web/dev fallback.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multi;
    if (types && types.length) input.accept = types.join(',');
    input.onchange = async () => {
      if (!input.files || !input.files.length) return resolve(null);
      const out = [];
      for (const file of input.files) {
        out.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
      resolve(out);
    };
    input.click();
  });
}

const PDF_TYPES = ['application/pdf'];
const IMG_TYPES = ['image/png', 'image/jpeg'];
const OFFICE_TYPES = {
  word: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};
// Android often reports .xml as text/plain and .xps as octet-stream, so we
// include those fallbacks alongside the canonical MIME types — otherwise the
// system picker would grey the files out. On the web fallback, the <input
// accept> list combines extension + MIME and the extension is what filters.
const XML_TYPES = ['.xml', 'application/xml', 'text/xml', 'text/plain'];
const XPS_TYPES = ['.xps', 'application/vnd.ms-xpsdocument', 'application/oxps', 'application/octet-stream'];

// ── export (save to app Documents + offer share) ─────────────────────────────
// Writes into the app's Documents directory so the user always has a copy, and
// returns its URI so the UI can offer "Share / Open with…". On web it triggers a
// download. Nothing is uploaded.

async function saveBytes(bytes, defaultName, kind) {
  const u8 = toU8(bytes);
  if (isNative) {
    const path = `Folio/${defaultName}`;
    await Filesystem.mkdir({ path: 'Folio', directory: Directory.Documents, recursive: true }).catch(() => {});
    await Filesystem.writeFile({
      path,
      data: u8ToBase64(u8),
      directory: Directory.Documents,
      recursive: true,
    });
    const uriRes = await Filesystem.getUri({ path, directory: Directory.Documents });
    return { saved: true, path, uri: uriRes.uri };
  }
  // Web download fallback.
  const blob = new Blob([u8], { type: mimeFor(kind) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { saved: true, path: defaultName };
}

async function saveMulti(files) {
  const written = [];
  for (const f of files) {
    const r = await saveBytes(f.bytes, f.name, /\.[a-z0-9]+$/i.test(f.name) ? f.name.split('.').pop() : 'pdf');
    written.push(r.path);
  }
  return { saved: true, count: written.length, dir: 'Documents/Folio' };
}

/** Offer the OS share sheet for a previously-saved file URI. */
async function shareFile(uri, title) {
  if (!isNative || !uri) return { shared: false };
  try {
    await Share.share({ title: title || 'Folio', url: uri });
    return { shared: true };
  } catch (_) {
    return { shared: false };
  }
}

// ── compose engine ops with raster where needed ──────────────────────────────

async function compress(bytes, opts = {}) {
  const u8 = toU8(bytes);
  if (!opts.raster) return pdf.compressStructural(u8);
  const imgs = await render.rasterizePages(u8, {
    scale: opts.scale || 1.5,
    format: 'jpg',
    quality: (opts.quality || 60) / 100,
    onProgress: opts.onProgress,
  });
  return pdf.imagesToPdf(imgs.map((p) => ({ bytes: p.bytes, type: 'jpg' })), { pageSize: 'fit' });
}

async function pdfToImages(bytes, format = 'png', scale = 2, onProgress) {
  const imgs = await render.rasterizePages(toU8(bytes), { scale, format, onProgress });
  return imgs.map((p) => ({
    name: `page-${String(p.index + 1).padStart(3, '0')}.${format === 'jpg' ? 'jpg' : 'png'}`,
    bytes: p.bytes,
    width: p.width,
    height: p.height,
  }));
}

async function ocrPdf(bytes, scale = 2, onProgress) {
  if (onProgress) onProgress(0.02);
  const imgs = await render.rasterizePages(toU8(bytes), {
    scale,
    format: 'png',
    onProgress: (p) => onProgress && onProgress(0.02 + p * 0.33),
  });
  // tesseract.js accepts a Blob/File/ImageLike; feed it data URLs.
  const pageImages = imgs.map((p) => ({
    image: 'data:image/png;base64,' + u8ToBase64(p.bytes),
    width: p.width,
    height: p.height,
  }));
  const results = await ocr.ocrPages(pageImages, {
    onProgress: (p) => onProgress && onProgress(0.35 + p * 0.65),
  });
  return { pages: results.map((r) => r.text), text: results.map((r) => r.text).join('\n\n') };
}

// ── the public surface (mirrors the Electron `window.folio`) ─────────────────

const folio = {
  isNative,

  // import
  openPdf: (multi = false) => pickFiles({ types: PDF_TYPES, multi }),
  openImages: () => pickFiles({ types: IMG_TYPES, multi: true }),
  openOffice: (kind) => pickFiles({ types: OFFICE_TYPES[kind], multi: false }),
  openXml: () => pickFiles({ types: XML_TYPES, multi: false }),
  openXps: () => pickFiles({ types: XPS_TYPES, multi: false }),
  openAny: () => pickFiles({ multi: false }),

  // export
  saveBytes,
  saveMulti,
  shareFile,

  // organize
  merge: (buffers) => pdf.merge(buffers.map(toU8)),
  split: (bytes, baseName) => pdf.splitToPages(toU8(bytes), baseName),
  extract: (bytes, range) => pdf.extractPages(toU8(bytes), range),
  deletePages: (bytes, range) => pdf.deletePages(toU8(bytes), range),
  rotate: (bytes, angle, range) => pdf.rotate(toU8(bytes), angle, range),
  compress,
  info: (bytes) => pdf.info(toU8(bytes)),

  // images
  pdfToImages,
  imagesToPdf: (images, pageSize = 'fit') =>
    pdf.imagesToPdf(
      images.map((im) => ({ bytes: toU8(im.bytes), type: /png/i.test(im.name) ? 'png' : 'jpg' })),
      { pageSize }
    ),

  // viewer
  renderPage: (bytes, pageIndex, scale = 1.6) => render.renderPageDataUrl(toU8(bytes), pageIndex, scale),
  geometry: (bytes) => render.pageGeometry(toU8(bytes)),

  // secure & sign
  watermark: (bytes, text, opacity = 0.18) => pdf.watermark(toU8(bytes), text, { opacity }),
  pageNumbers: (bytes, format, position) => pdf.pageNumbers(toU8(bytes), { format, position }),
  flatten: (bytes) => pdf.flatten(toU8(bytes)),
  sign: (bytes, signaturePng, opts = {}) => pdf.stampSignature(toU8(bytes), toU8(signaturePng), opts),
  unlock: (bytes) => pdf.unlock(toU8(bytes)),
  protect: () => pdf.protect(),

  // scan & read
  extractText: (bytes) => render.extractText(toU8(bytes)),
  ocrImage: (bytes, onProgress) =>
    ocr.ocrImage('data:image/png;base64,' + u8ToBase64(toU8(bytes)), { onProgress }),
  ocrPdf,

  // convert
  pdfToWord: (bytes) => office.pdfToWord(toU8(bytes)),
  pdfToExcel: (bytes) => office.pdfToExcel(toU8(bytes)),
  pdfToPpt: (bytes) => office.pdfToPpt(toU8(bytes)),
  wordToPdf: (bytes) => office.wordToPdf(toU8(bytes)),
  excelToPdf: (bytes) => office.excelToPdf(toU8(bytes)),
  pptToPdf: () => office.pptToPdf(),

  // convert — XML / XPS (shared xmlEngine + xpsEngine)
  xmlToPdf: (bytes) => xml.xmlToPdf(toU8(bytes)),
  pdfToXml: (bytes) => xml.pdfToXml(toU8(bytes)),
  viewXml: (bytes) => xml.viewXml(toU8(bytes)),
  pdfToXps: (bytes, onProgress) =>
    xps.pdfToXps(toU8(bytes), (b, o) => render.rasterizePages(b, { ...o, onProgress }), { scale: 2 }),
  xpsToPdf: (bytes) => xps.xpsToPdf(toU8(bytes)),
  viewXps: (bytes) => xps.viewXps(toU8(bytes)),

  // util
  _u8: toU8,
  _dataUrlToU8: dataUrlToU8,
};

export default folio;
