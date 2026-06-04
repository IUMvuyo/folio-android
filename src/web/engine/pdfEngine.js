// pdfEngine — organize / optimize operations, 100% on-device via pdf-lib.
// Pure functions over Uint8Array. No fs, no network. Ported 1:1 from the
// Folio-Windows Electron build; the only change is ESM imports so it runs in
// the Android WebView (pdf-lib is pure JS and runs unchanged in a browser).

import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';

/** Parse a page-range spec like "1-3,5,8-10" (1-based) into a sorted unique
 *  array of 0-based indices, clamped to [0, pageCount). */
export function parseRanges(spec, pageCount) {
  if (!spec || !spec.trim()) {
    return [...Array(pageCount).keys()];
  }
  const out = new Set();
  for (const partRaw of spec.split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    if (part.includes('-')) {
      let [a, b] = part.split('-').map((s) => parseInt(s.trim(), 10));
      if (Number.isNaN(a)) a = 1;
      if (Number.isNaN(b)) b = pageCount;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) {
        if (i >= 1 && i <= pageCount) out.add(i - 1);
      }
    } else {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= pageCount) out.add(n - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

async function load(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/** Merge an ordered list of PDF byte buffers into one. */
export async function merge(buffers) {
  const out = await PDFDocument.create();
  for (const bytes of buffers) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Split a PDF into N single-page documents. Returns [{name, bytes}]. */
export async function splitToPages(bytes, baseName = 'page') {
  const src = await load(bytes);
  const count = src.getPageCount();
  const results = [];
  for (let i = 0; i < count; i++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [i]);
    out.addPage(page);
    results.push({
      name: `${baseName}-${String(i + 1).padStart(3, '0')}.pdf`,
      bytes: await out.save(),
    });
  }
  return results;
}

/** Extract a subset of pages (range spec) into a single new PDF. */
export async function extractPages(bytes, rangeSpec) {
  const src = await load(bytes);
  const idxs = parseRanges(rangeSpec, src.getPageCount());
  if (idxs.length === 0) throw new Error('No pages matched that range.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idxs);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** Delete a subset of pages (range spec) and keep the rest. */
export async function deletePages(bytes, rangeSpec) {
  const src = await load(bytes);
  const total = src.getPageCount();
  const remove = new Set(parseRanges(rangeSpec, total));
  const keep = [...Array(total).keys()].filter((i) => !remove.has(i));
  if (keep.length === 0) throw new Error('That would delete every page.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, keep);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/** Rotate pages by a multiple of 90°. rangeSpec empty = all pages. */
export async function rotate(bytes, angle, rangeSpec) {
  const doc = await load(bytes);
  const idxs = new Set(parseRanges(rangeSpec, doc.getPageCount()));
  const norm = ((angle % 360) + 360) % 360;
  doc.getPages().forEach((page, i) => {
    if (idxs.has(i)) {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + norm) % 360));
    }
  });
  return doc.save();
}

/** Compress — re-save with object streams (compacts structure, dedupes). For
 *  true image downsampling the bridge rasterizes via pdfjs then rebuilds. */
export async function compressStructural(bytes) {
  const doc = await load(bytes);
  return doc.save({ useObjectStreams: true });
}

/** Build a PDF from a list of raster images. Each {bytes, type:'png'|'jpg'}. */
export async function imagesToPdf(images, { pageSize = 'fit' } = {}) {
  const out = await PDFDocument.create();
  for (const img of images) {
    let embedded;
    if (img.type === 'png') embedded = await out.embedPng(img.bytes);
    else embedded = await out.embedJpg(img.bytes);
    const { width, height } = embedded;
    if (pageSize === 'a4') {
      const A4W = 595.28;
      const A4H = 841.89;
      const page = out.addPage([A4W, A4H]);
      const scale = Math.min(A4W / width, A4H / height);
      const w = width * scale;
      const h = height * scale;
      page.drawImage(embedded, { x: (A4W - w) / 2, y: (A4H - h) / 2, width: w, height: h });
    } else {
      const page = out.addPage([width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });
    }
  }
  return out.save();
}

// ── Secure & Sign (the pure-pdf-lib subset) ─────────────────────────────────

/** Watermark every page with diagonal text. */
export async function watermark(bytes, text, { opacity = 0.18, fontSize = 48 } = {}) {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
      size: fontSize,
      font,
      color: rgb(0.75, 0.14, 0.13),
      rotate: degrees(45),
      opacity,
    });
  });
  return doc.save();
}

/** Add page numbers. format supports {n} and {total}. */
export async function pageNumbers(
  bytes,
  { format = '{n} / {total}', position = 'bottom-center', fontSize = 11 } = {}
) {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    const label = format.replace('{n}', i + 1).replace('{total}', total);
    const { width } = page.getSize();
    const tw = font.widthOfTextAtSize(label, fontSize);
    let x = width / 2 - tw / 2;
    if (position.endsWith('left')) x = 36;
    else if (position.endsWith('right')) x = width - tw - 36;
    const y = position.startsWith('top') ? page.getSize().height - 28 : 24;
    page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.16, 0.14, 0.12) });
  });
  return doc.save();
}

/** Flatten — drop the interactive AcroForm so fields/annotations bake in. */
export async function flatten(bytes) {
  const src = await load(bytes);
  try {
    const form = src.getForm();
    form.flatten();
  } catch (_) { /* no form present */ }
  return src.save();
}

/** Stamp a signature PNG (drawn on a canvas) onto a page. */
export async function stampSignature(bytes, pngBytes, { pageIndex = 0, x, y, width, height } = {}) {
  const doc = await load(bytes);
  const png = await doc.embedPng(pngBytes);
  const pages = doc.getPages();
  const idx = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  const page = pages[idx];
  const ps = page.getSize();
  const w = width || png.width;
  const h = height || png.height;
  page.drawImage(png, {
    x: x != null ? x : ps.width - w - 48,
    y: y != null ? y : 48,
    width: w,
    height: h,
  });
  return doc.save();
}

/**
 * Password-protect: pdf-lib cannot natively encrypt, so we wrap the document in
 * a fresh save with encryption disabled-but-noted is NOT honest. Instead we use
 * pdf-lib's lower-level save and rely on a JS encrypt shim only if present.
 * pdf-lib (1.17) has no public encryption API, so protect is surfaced as
 * "coming soon" in the UI rather than producing an unprotected file. This stub
 * throws so the bridge can mark it clearly.
 */
export async function protect() {
  throw new Error('SOON');
}

/** Remove a known password (decrypt). pdf-lib loads with ignoreEncryption, so
 *  re-saving yields an unencrypted copy. Works when you can already open it. */
export async function unlock(bytes) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return src.save();
}

/** Read basic info (page count, sizes) for the UI. */
export async function info(bytes) {
  const doc = await load(bytes);
  return {
    pageCount: doc.getPageCount(),
    sizes: doc.getPages().map((p) => {
      const s = p.getSize();
      return { width: Math.round(s.width), height: Math.round(s.height) };
    }),
  };
}
