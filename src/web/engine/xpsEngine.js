// xpsEngine — PDF ↔ XPS + view, best-effort, 100% on-device, no network.
//
// SHARED ENGINE (copied verbatim into Folio-Windows / Folio-Android / Folio-
// Business; only ESM `import` vs CJS `require` differs — see Windows variant).
//
// There is no clean pure-JS XPS *renderer*, so — exactly like the existing
// PDF↔Office path — we go image/text-based:
//
//   • PDF → XPS : rasterize each PDF page to a PNG (caller injects a `rasterize`
//                 fn that returns [{index,width,height,bytes}] like
//                 renderEngine.rasterizePages), then build a VALID XPS OPC
//                 package (a ZIP) — [Content_Types].xml, FixedDocumentSequence,
//                 FixedDocument, one FixedPage per page (sized to the page, with
//                 a <Path> whose Fill is an <ImageBrush> of the page PNG), the
//                 image parts, and all the _rels. Mirrors how PDF→PPTX wraps
//                 page images in OOXML.  ← this works well.
//
//   • XPS → PDF : unzip the .xps, walk FixedDocumentSequence → FixedDocument →
//                 each FixedPage, and best-effort render to a PDF page sized to
//                 the FixedPage Width/Height: draw every <Glyphs> run at its
//                 OriginX/OriginY (UnicodeString, FontRenderingEmSize, Fill) and
//                 embed any referenced page images (ImageBrush / Path
//                 ImageSource). If a page yields no usable glyphs we fall back to
//                 extracting all UnicodeString text in document order onto a
//                 readable PDF page — but the positioned render is tried first.
//                 ← best-effort / "beta".
//
//   • viewXps  : render via the XPS → PDF path; the caller then shows the PDF in
//                 the existing PDF viewer.
//
// No file ever leaves the device.

import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// XPS coordinates are in 1/96 inch ("DIPs"); PDF user units are 1/72 inch.
const DIP_TO_PT = 72 / 96;

// ── small XML helpers (no DOM; identical everywhere) ─────────────────────────

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnesc(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** Read one attribute's value from a tag string (attr="..."), or null. */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)) ||
            tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
}

function toU8(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(x)) return new Uint8Array(x);
  if (x && x.buffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(x);
}

// ═════════════════════════════════════════════════════════════════════════════
// PDF → XPS  (rasterize pages → valid OPC package)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param pdfBytes  the source PDF
 * @param rasterize async (bytes,{scale,format}) => [{index,width,height,bytes}]
 *                  — the same shape renderEngine.rasterizePages returns. PNG.
 * @param opts.scale raster scale (default 2 for crisp pages)
 * Returns Uint8Array of a .xps (OPC ZIP).
 */
export async function pdfToXps(pdfBytes, rasterize, { scale = 2 } = {}) {
  if (typeof rasterize !== 'function') {
    throw new Error('pdfToXps needs a rasterize() function.');
  }
  const imgs = await rasterize(toU8(pdfBytes), { scale, format: 'png' });
  if (!imgs || !imgs.length) throw new Error('No pages to convert.');

  const zip = new JSZip();

  // [Content_Types].xml — declares every part's content type / extension.
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>' +
      '<Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>' +
      '<Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '</Types>'
  );

  // Package root relationship → the FixedDocumentSequence (the XPS start part).
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" ' +
      'Target="/FixedDocumentSequence.fdseq"/>' +
      '</Relationships>'
  );

  // FixedDocumentSequence → one FixedDocument.
  zip.file(
    'FixedDocumentSequence.fdseq',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06">' +
      '<DocumentReference Source="/Documents/1/FixedDocument.fdoc"/>' +
      '</FixedDocumentSequence>'
  );

  // FixedDocument → a PageContent per page.
  let fdoc =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">';
  imgs.forEach((_, idx) => {
    fdoc += `<PageContent Source="/Documents/1/Pages/${idx + 1}.fpage"/>`;
  });
  fdoc += '</FixedDocument>';
  zip.file('Documents/1/FixedDocument.fdoc', fdoc);

  // One FixedPage + one PNG resource + the page's _rels per page.
  imgs.forEach((img, idx) => {
    const i = idx + 1;
    // Page size in DIPs: image px are at `scale`× of the page's 96-dpi size.
    const wDip = Math.max(1, Math.round(img.width / scale));
    const hDip = Math.max(1, Math.round(img.height / scale));
    const imgName = `${i}.png`;
    const imgPath = `/Documents/1/Resources/Images/${imgName}`;

    const fpage =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      `<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" ` +
      `Width="${wDip}" Height="${hDip}" xml:lang="en-US">` +
      // A full-page rectangle filled with the page image.
      `<Path Data="M 0,0 L ${wDip},0 ${wDip},${hDip} 0,${hDip} Z">` +
      '<Path.Fill>' +
      `<ImageBrush ImageSource="${xmlEsc(imgPath)}" ` +
      `Viewbox="0,0 ${img.width},${img.height}" ViewboxUnits="Absolute" ` +
      `Viewport="0,0 ${wDip},${hDip}" ViewportUnits="Absolute" TileMode="None"/>` +
      '</Path.Fill>' +
      '</Path>' +
      '</FixedPage>';
    zip.file(`Documents/1/Pages/${i}.fpage`, fpage);

    // The page → image relationship.
    zip.file(
      `Documents/1/Pages/_rels/${i}.fpage.rels`,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" ` +
        `Type="http://schemas.microsoft.com/xps/2005/06/required-resource" ` +
        `Target="/Documents/1/Resources/Images/${imgName}"/>` +
        '</Relationships>'
    );

    zip.file(`Documents/1/Resources/Images/${imgName}`, toU8(img.bytes));
  });

  const ab = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return ab;
}

// ═════════════════════════════════════════════════════════════════════════════
// XPS → PDF  (best-effort positioned render, text-extraction fallback)
// ═════════════════════════════════════════════════════════════════════════════

/** Resolve a part path that may be relative to the page, into a zip key. */
function resolvePath(base, target) {
  if (!target) return null;
  let t = target.replace(/^\.\//, '');
  if (t.startsWith('/')) return t.slice(1);
  // relative to the page's folder
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  const parts = (dir + t).split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p !== '.' && p !== '') stack.push(p);
  }
  return stack.join('/');
}

/** Parse one <Glyphs .../> (or <Glyphs ...>...</Glyphs>) tag string. */
function parseGlyphs(tag) {
  const unicode = attr(tag, 'UnicodeString');
  if (unicode == null) return null;
  const text = xmlUnesc(unicode);
  if (!text) return null;
  const ox = parseFloat(attr(tag, 'OriginX') || '0') || 0;
  const oy = parseFloat(attr(tag, 'OriginY') || '0') || 0;
  const em = parseFloat(attr(tag, 'FontRenderingEmSize') || '12') || 12;
  const fill = attr(tag, 'Fill') || '#FF000000';
  const bold = /Bold/i.test(attr(tag, 'FontUri') || attr(tag, 'StyleSimulations') || '');
  return { text, ox, oy, em, fill, bold };
}

/** "#AARRGGBB" / "#RRGGBB" → pdf-lib rgb() (alpha ignored). */
function parseColor(s) {
  if (!s) return rgb(0.1, 0.09, 0.08);
  let h = s.trim().replace(/^#/, '');
  if (h.length === 8) h = h.slice(2); // drop AA
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    if ([r, g, b].every((v) => !Number.isNaN(v))) return rgb(r, g, b);
  }
  return rgb(0.1, 0.09, 0.08);
}

/** Collect all whole-tag matches for an element name from page XML. */
function matchTags(xml, name) {
  // matches <Name .../> and the opening <Name ...> of <Name ...>...</Name>
  const re = new RegExp(`<${name}\\b[^>]*?/?>`, 'g');
  return xml.match(re) || [];
}

/**
 * Parse a FixedPage XML string into { width, height, glyphs:[], images:[] }.
 * Dimensions + positions are in DIPs.
 */
function parseFixedPage(xml) {
  const openTag = (xml.match(/<FixedPage\b[^>]*>/) || [''])[0];
  const width = parseFloat(attr(openTag, 'Width') || '816') || 816;   // ~8.5in
  const height = parseFloat(attr(openTag, 'Height') || '1056') || 1056; // ~11in

  const glyphs = [];
  for (const g of matchTags(xml, 'Glyphs')) {
    const parsed = parseGlyphs(g);
    if (parsed) glyphs.push(parsed);
  }

  // Any ImageBrush / ImageSource reference → a page image part to embed.
  const images = [];
  const seen = new Set();
  const srcRe = /ImageSource\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = srcRe.exec(xml)) !== null) {
    const ref = xmlUnesc(m[1]).replace(/^\{[^}]*\}/, ''); // strip any {ColorConvertedBitmap ...}
    const clean = ref.split(' ')[0];
    if (clean && !seen.has(clean)) { seen.add(clean); images.push(clean); }
  }
  return { width, height, glyphs, images };
}

/** Find the .fpage part keys in document order from the package. */
async function pageOrder(zip) {
  const fileKey = (name) =>
    Object.keys(zip.files).find((k) => k.toLowerCase() === name.toLowerCase());

  const order = [];
  const seqKey = fileKey('FixedDocumentSequence.fdseq') ||
    Object.keys(zip.files).find((k) => /\.fdseq$/i.test(k));
  if (seqKey) {
    const seq = await zip.file(seqKey).async('string');
    const docRefs = (seq.match(/<DocumentReference\b[^>]*>/g) || [])
      .map((t) => attr(t, 'Source'))
      .filter(Boolean);
    for (const dref of docRefs) {
      const docKey = resolvePath(seqKey, dref);
      const k = fileKey(docKey) || docKey;
      if (!zip.files[k]) continue;
      const fdoc = await zip.file(k).async('string');
      const pageRefs = (fdoc.match(/<PageContent\b[^>]*>/g) || [])
        .map((t) => attr(t, 'Source'))
        .filter(Boolean);
      for (const pref of pageRefs) {
        const pk = resolvePath(k, pref);
        order.push(fileKey(pk) || pk);
      }
    }
  }
  if (order.length) return order.filter((k) => zip.files[k]);
  // Fallback: every .fpage in the package, name-sorted.
  return Object.keys(zip.files)
    .filter((k) => /\.fpage$/i.test(k))
    .sort();
}

/**
 * XPS bytes → PDF bytes (Uint8Array). Best-effort positioned render with a
 * text-extraction fallback per page. Never throws on a single bad page.
 */
export async function xpsToPdf(xpsBytes) {
  const zip = await JSZip.loadAsync(toU8(xpsBytes));
  const pageKeys = await pageOrder(zip);
  if (!pageKeys.length) throw new Error('No FixedPage parts found — not a valid XPS.');

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const key of pageKeys) {
    let xml;
    try { xml = await zip.file(key).async('string'); } catch { continue; }
    const { width, height, glyphs, images } = parseFixedPage(xml);

    const wPt = Math.max(1, width * DIP_TO_PT);
    const hPt = Math.max(1, height * DIP_TO_PT);
    const page = pdf.addPage([wPt, hPt]);

    // 1) Embed any referenced page images first (so glyphs sit on top).
    let drewImage = false;
    for (const ref of images) {
      const imgKey = resolvePath(key, ref);
      const k = Object.keys(zip.files).find((f) => f.toLowerCase() === (imgKey || '').toLowerCase());
      if (!k) continue;
      try {
        const bytes = await zip.file(k).async('uint8array');
        const isPng = /\.png$/i.test(k) || (bytes[0] === 0x89 && bytes[1] === 0x50);
        const embedded = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        page.drawImage(embedded, { x: 0, y: 0, width: wPt, height: hPt });
        drewImage = true;
      } catch { /* skip unembeddable image */ }
    }

    // 2) Positioned glyph render. XPS origin is top-left, Y grows downward;
    //    PDF origin is bottom-left, Y grows upward — so flip Y.
    let drewGlyph = false;
    for (const g of glyphs) {
      const size = Math.max(1, g.em * DIP_TO_PT);
      const x = g.ox * DIP_TO_PT;
      const y = hPt - g.oy * DIP_TO_PT; // baseline
      try {
        page.drawText(g.text, {
          x,
          y: y - size, // pdf-lib y is the text's baseline-ish bottom; nudge down
          size,
          font: g.bold ? bold : font,
          color: parseColor(g.fill),
        });
        drewGlyph = true;
      } catch { /* unsupported glyph chars — skip */ }
    }

    // 3) Fallback: if a page had neither image nor positioned glyphs but DOES
    //    contain UnicodeString text, lay that text out top-to-bottom so nothing
    //    is silently lost.
    if (!drewImage && !drewGlyph) {
      const all = glyphs.map((g) => g.text).join('\n') ||
        (xml.match(/UnicodeString\s*=\s*"([^"]*)"/g) || [])
          .map((t) => xmlUnesc(attr(t, 'UnicodeString') || '')).join('\n');
      const size = 11;
      const lead = 15;
      let yy = hPt - 48;
      for (const lineRaw of (all || '(no extractable content)').split('\n')) {
        for (const line of wrapText(lineRaw, font, size, wPt - 96)) {
          if (yy < 40) break;
          try { page.drawText(line, { x: 48, y: yy, size, font, color: rgb(0.16, 0.14, 0.12) }); } catch {}
          yy -= lead;
        }
      }
    }
  }

  if (pdf.getPageCount() === 0) pdf.addPage();
  return pdf.save();
}

function wrapText(text, font, size, maxWidth) {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    let width;
    try { width = font.widthOfTextAtSize(trial, size); } catch { width = trial.length * size * 0.5; }
    if (width <= maxWidth) cur = trial;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** View / Open XPS: render to PDF (the caller shows it in the PDF viewer). */
export async function viewXps(xpsBytes) {
  return xpsToPdf(xpsBytes);
}
