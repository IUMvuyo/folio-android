// app.js — Folio's editorial renderer UI for Android.
//
// The Electron Windows project shipped index.html referencing an app.js that
// was never committed; this is that renderer, written fresh against the SAME
// iOS feature set / desk grouping (Folio/Models/FolioTool.swift) and the SAME
// editorial look. It drives every tool through the in-WebView `folio` bridge.

import folio from './bridge.js';

// Expose for debugging / console; the UI uses the imported binding directly.
window.folio = folio;

// ── the desks + tools (mirrors FolioTool.swift exactly) ──────────────────────

const DESKS = [
  { id: 'organize', title: 'Organize', blurb: 'Combine, divide and tidy your pages.' },
  { id: 'convert', title: 'Convert', blurb: 'Move between PDF, Office and images.' },
  { id: 'secure', title: 'Secure & Sign', blurb: 'Lock, mark, sign and flatten.' },
  { id: 'scan', title: 'Scan & Read', blurb: 'Make scans searchable. Pull out text.' },
];

const TOOLS = [
  // Organize
  { id: 'merge', desk: 'organize', title: 'Merge PDFs', blurb: 'Combine several PDFs into one, in any order.' },
  { id: 'splitPages', desk: 'organize', title: 'Split PDF', blurb: 'Break one PDF into single pages or ranges.' },
  { id: 'rotate', desk: 'organize', title: 'Rotate Pages', blurb: 'Turn pages 90°, 180° or 270°.' },
  { id: 'deletePages', desk: 'organize', title: 'Delete Pages', blurb: "Remove the pages you don't need." },
  { id: 'extractPages', desk: 'organize', title: 'Extract Pages', blurb: 'Pull selected pages into a new PDF.' },
  { id: 'compress', desk: 'organize', title: 'Compress PDF', blurb: 'Shrink file size by re-encoding images.' },
  // Convert
  { id: 'pdfToImages', desk: 'convert', title: 'PDF → Images', blurb: 'Export each page as a JPG or PNG.' },
  { id: 'imagesToPdf', desk: 'convert', title: 'Images → PDF', blurb: 'Bind photos and images into one PDF.' },
  { id: 'pdfToWord', desk: 'convert', title: 'PDF → Word', blurb: 'Best-effort editable .docx — text and images.' },
  { id: 'pdfToExcel', desk: 'convert', title: 'PDF → Excel', blurb: 'Best-effort .xlsx — lines and tables.' },
  { id: 'pdfToPpt', desk: 'convert', title: 'PDF → PowerPoint', blurb: 'Each page becomes a slide.' },
  { id: 'wordToPdf', desk: 'convert', title: 'Word → PDF', blurb: 'Render a Word document to PDF.' },
  { id: 'excelToPdf', desk: 'convert', title: 'Excel → PDF', blurb: 'Render a spreadsheet to PDF.' },
  { id: 'pptToPdf', desk: 'convert', title: 'PowerPoint → PDF', blurb: 'Render slides to PDF.', soon: true },
  { id: 'xmlToPdf', desk: 'convert', title: 'XML → PDF', blurb: 'Pretty-print any XML to a readable PDF.' },
  { id: 'pdfToXml', desk: 'convert', title: 'PDF → XML', blurb: 'Extract text into structured XML. Best-effort.' },
  { id: 'pdfToXps', desk: 'convert', title: 'PDF → XPS', blurb: 'Build an XPS from page images.' },
  { id: 'xpsToPdf', desk: 'convert', title: 'XPS → PDF', blurb: 'Render an XPS document to PDF. Beta.' },
  // Secure & Sign
  { id: 'protectPdf', desk: 'secure', title: 'Password Protect', blurb: 'Lock a PDF with a password.', soon: true },
  { id: 'unlockPdf', desk: 'secure', title: 'Remove Password', blurb: 'Remove a password you know.' },
  { id: 'watermark', desk: 'secure', title: 'Watermark', blurb: 'Stamp text across every page.' },
  { id: 'pageNumbers', desk: 'secure', title: 'Add Page Numbers', blurb: 'Number every page, your way.' },
  { id: 'signFill', desk: 'secure', title: 'Sign & Fill', blurb: 'Draw a signature and place it.' },
  { id: 'flatten', desk: 'secure', title: 'Flatten PDF', blurb: 'Bake annotations into the page.' },
  // Scan & Read
  { id: 'ocrSearchable', desk: 'scan', title: 'Make Searchable (OCR)', blurb: 'Add a searchable text layer to scans.' },
  { id: 'extractText', desk: 'scan', title: 'Extract Text', blurb: 'Copy out all the text in a document.' },
  { id: 'viewPDF', desk: 'scan', title: 'View PDF', blurb: 'Open and read any PDF — scroll, zoom, page.' },
  { id: 'viewXML', desk: 'scan', title: 'View XML', blurb: 'Open and read XML, neatly formatted.' },
  { id: 'viewXPS', desk: 'scan', title: 'View XPS', blurb: 'Open an XPS document for reading. Beta.' },
];

// ── tiny DOM helpers ─────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

// ── desk grid ────────────────────────────────────────────────────────────────

function buildDesks() {
  const root = $('#deskRoot');
  root.innerHTML = '';
  for (const desk of DESKS) {
    root.appendChild(
      el('div', { class: 'section' },
        el('span', { class: 'bar' }),
        el('span', { class: 'sectionlabel' }, desk.title),
        el('span', { class: 'bar' })
      )
    );
    const grid = el('div', { class: 'grid' });
    for (const tool of TOOLS.filter((t) => t.desk === desk.id)) {
      const card = el('div', { class: 'card' + (tool.soon ? ' soon' : '') },
        el('div', { class: 'card-kicker' }, desk.title),
        el('div', { class: 'card-title' }, tool.title),
        el('div', { class: 'card-blurb' }, tool.blurb)
      );
      if (tool.soon) card.appendChild(el('span', { class: 'soon-tag' }, 'coming soon'));
      card.addEventListener('click', () => openTool(tool));
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }
}

// ── panel scaffolding ──────────────────────────────────────────────────────

let panelState = {}; // per-open scratch (loaded file bytes, file lists, etc.)

function closePanel() {
  $('#scrim').classList.remove('open');
  $('#panel').innerHTML = '';
  panelState = {};
}

function panelShell(tool, bodyNodes, actionNodes) {
  const panel = $('#panel');
  panel.innerHTML = '';
  const deskTitle = DESKS.find((d) => d.id === tool.desk).title;
  panel.appendChild(
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-kicker' }, deskTitle),
      el('div', { class: 'panel-title' }, tool.title),
      el('div', { class: 'panel-blurb' }, tool.blurb)
    )
  );
  const body = el('div', { class: 'panel-body' });
  for (const n of bodyNodes) if (n) body.appendChild(n);
  panel.appendChild(body);

  const status = el('span', { class: 'status' }, '');
  const actions = el('div', { class: 'actions' });
  for (const n of actionNodes) if (n) actions.appendChild(n);
  actions.appendChild(el('button', { class: 'btn ghost', onclick: closePanel }, 'close'));
  actions.appendChild(status);
  panel.appendChild(actions);

  $('#scrim').classList.add('open');
  return { panel, body, status };
}

function setStatus(status, msg, isErr = false) {
  status.textContent = msg || '';
  status.classList.toggle('err', !!isErr);
}

function progressBar() {
  const wrap = el('div', { class: 'progress' });
  const inner = el('div');
  wrap.appendChild(inner);
  wrap.set = (p) => { inner.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; };
  return wrap;
}

function filedStamp() {
  return el('div', { class: 'filed' }, 'FILED');
}

// A labelled <input>/<select> row.
function row(labelText, control) {
  return el('div', { class: 'row' }, el('label', {}, labelText), control);
}

// ── file-picker row used by most tools ──────────────────────────────────────

function pickRow({ label, accept, multi, onPicked }) {
  const list = el('div', { class: 'filelist' });
  const render = (files) => {
    list.innerHTML = '';
    if (!files.length) {
      list.appendChild(el('div', { class: 'fileitem' }, el('span', {}, 'No file chosen yet.')));
      return;
    }
    files.forEach((f, i) => {
      const ord = el('span', { class: 'ord' });
      if (multi) {
        ord.appendChild(el('button', { onclick: () => { if (i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; render(files); } } }, '↑'));
        ord.appendChild(el('button', { onclick: () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; render(files); } } }, '↓'));
      }
      const rm = el('button', { class: 'rm', onclick: () => { files.splice(i, 1); render(files); } }, '✕');
      list.appendChild(
        el('div', { class: 'fileitem' },
          el('span', {}, f.name),
          el('span', { class: 'fmeta' }, `${(f.bytes.length / 1024).toFixed(0)} KB`),
          el('span', { class: 'ord' }, ord, rm)
        )
      );
    });
  };
  const files = [];
  render(files);

  const btn = el('button', { class: 'btn', onclick: async () => {
    const picked = accept === 'pdf' ? await folio.openPdf(multi)
      : accept === 'images' ? await folio.openImages()
      : accept === 'word' ? await folio.openOffice('word')
      : accept === 'excel' ? await folio.openOffice('excel')
      : accept === 'ppt' ? await folio.openOffice('ppt')
      : accept === 'xml' ? await folio.openXml()
      : accept === 'xps' ? await folio.openXps()
      : await folio.openAny();
    if (!picked) return;
    if (multi) files.push(...picked);
    else { files.length = 0; files.push(picked[0]); }
    render(files);
    if (onPicked) onPicked(files);
  } }, multi ? 'add file(s)' : 'choose file');

  const wrap = el('div', { class: 'row' }, el('label', {}, label), btn, el('div', { style: 'height:10px' }), list);
  wrap.files = files;
  return wrap;
}

// ── primary "run" button factory ─────────────────────────────────────────────

function runButton(label, handler, status) {
  const btn = el('button', { class: 'btn primary' }, label);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus(status, 'working…');
    try {
      await handler();
    } catch (e) {
      console.error(e);
      const msg = e && e.message === 'SOON' ? 'coming soon' : (e && e.message) || 'something went wrong';
      setStatus(status, msg, true);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

// After producing a file, save it and offer share.
async function deliver(bytes, name, kind, status) {
  const res = await folio.saveBytes(bytes, name, kind);
  if (res.saved) {
    setStatus(status, folio.isNative ? 'filed to Documents/Folio' : 'downloaded');
    if (folio.isNative && res.uri) await folio.shareFile(res.uri, name);
  }
  return res;
}

// ── tool routing ─────────────────────────────────────────────────────────────

function openTool(tool) {
  const builder = BUILDERS[tool.id];
  if (builder) return builder(tool);
  // generic single-PDF passthrough fallback (shouldn't be reached)
  simplePdfTool(tool, async (bytes) => bytes, 'output.pdf');
}

// generic "pick one PDF, run fn(bytes)->bytes, save as .pdf" tool
function simplePdfTool(tool, fn, outName, extraRows = []) {
  const pick = pickRow({ label: 'Source PDF', accept: 'pdf', multi: false });
  const { status, body } = panelShell(tool, [pick, ...extraRows], []);
  const run = runButton('run', async () => {
    if (!pick.files.length) return setStatus(status, 'choose a PDF first', true);
    const out = await fn(pick.files[0].bytes, extraRows);
    await deliver(out, outName(pick.files[0]), 'pdf', status);
    body.appendChild(filedStamp());
  }, status);
  $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
}

const baseName = (f) => (f.name || 'document').replace(/\.[^.]+$/, '');

const BUILDERS = {
  // ── ORGANIZE ──────────────────────────────────────────────────────────────
  merge(tool) {
    const pick = pickRow({ label: 'PDFs to merge (in order)', accept: 'pdf', multi: true });
    const { status } = panelShell(tool, [pick], []);
    const run = runButton('merge', async () => {
      if (pick.files.length < 2) return setStatus(status, 'add at least two PDFs', true);
      const out = await folio.merge(pick.files.map((f) => f.bytes));
      await deliver(out, 'merged.pdf', 'pdf', status);
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  splitPages(tool) {
    const pick = pickRow({ label: 'PDF to split', accept: 'pdf', multi: false });
    const { status } = panelShell(tool, [pick], []);
    const run = runButton('split', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      const parts = await folio.split(pick.files[0].bytes, baseName(pick.files[0]));
      const r = await folio.saveMulti(parts);
      setStatus(status, `${r.count} page files filed`);
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  rotate(tool) {
    const range = el('input', { type: 'text', placeholder: 'e.g. 1-3,5 (blank = all)' });
    const angle = el('select', {},
      el('option', { value: '90' }, '90° clockwise'),
      el('option', { value: '180' }, '180°'),
      el('option', { value: '270' }, '270° (90° counter-clockwise)')
    );
    simplePdfTool(tool,
      (bytes) => folio.rotate(bytes, parseInt(angle.value, 10), range.value),
      (f) => `${baseName(f)}-rotated.pdf`,
      [row('Pages', range), row('Angle', angle)]);
  },

  deletePages(tool) {
    const range = el('input', { type: 'text', placeholder: 'e.g. 2,4-6' });
    simplePdfTool(tool,
      (bytes) => folio.deletePages(bytes, range.value),
      (f) => `${baseName(f)}-trimmed.pdf`,
      [row('Pages to delete', range)]);
  },

  extractPages(tool) {
    const range = el('input', { type: 'text', placeholder: 'e.g. 1-3,7' });
    simplePdfTool(tool,
      (bytes) => folio.extract(bytes, range.value),
      (f) => `${baseName(f)}-extract.pdf`,
      [row('Pages to keep', range)]);
  },

  compress(tool) {
    const mode = el('select', {},
      el('option', { value: 'struct' }, 'structural (lossless, fast)'),
      el('option', { value: 'raster' }, 'aggressive (re-encode images, smaller)')
    );
    const quality = el('input', { type: 'number', value: '60', min: '20', max: '95' });
    const prog = progressBar();
    const pick = pickRow({ label: 'PDF to compress', accept: 'pdf', multi: false });
    const { status, body } = panelShell(tool, [pick, row('Mode', mode), row('JPEG quality (aggressive only)', quality), prog], []);
    const run = runButton('compress', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      const before = pick.files[0].bytes.length;
      const out = await folio.compress(pick.files[0].bytes, {
        raster: mode.value === 'raster',
        quality: parseInt(quality.value, 10),
        onProgress: (p) => prog.set(p),
      });
      const pct = Math.max(0, Math.round((1 - out.length / before) * 100));
      await deliver(out, `${baseName(pick.files[0])}-compressed.pdf`, 'pdf', status);
      setStatus(status, `filed · ${pct}% smaller`);
      body.appendChild(filedStamp());
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  // ── CONVERT ────────────────────────────────────────────────────────────────
  pdfToImages(tool) {
    const fmt = el('select', {}, el('option', { value: 'png' }, 'PNG'), el('option', { value: 'jpg' }, 'JPG'));
    const scale = el('select', {}, el('option', { value: '2' }, 'high (2×)'), el('option', { value: '3' }, 'very high (3×)'), el('option', { value: '1.5' }, 'standard (1.5×)'));
    const prog = progressBar();
    const pick = pickRow({ label: 'PDF to rasterize', accept: 'pdf', multi: false });
    const { status } = panelShell(tool, [pick, row('Format', fmt), row('Resolution', scale), prog], []);
    const run = runButton('export images', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      const imgs = await folio.pdfToImages(pick.files[0].bytes, fmt.value, parseFloat(scale.value), (p) => prog.set(p));
      const r = await folio.saveMulti(imgs);
      setStatus(status, `${r.count} images filed`);
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  imagesToPdf(tool) {
    const size = el('select', {}, el('option', { value: 'fit' }, 'fit page to image'), el('option', { value: 'a4' }, 'A4 pages'));
    const pick = pickRow({ label: 'Images (PNG / JPG)', accept: 'images', multi: true });
    const { status } = panelShell(tool, [pick, row('Page size', size)], []);
    const run = runButton('bind to PDF', async () => {
      if (!pick.files.length) return setStatus(status, 'add some images', true);
      const out = await folio.imagesToPdf(pick.files, size.value);
      await deliver(out, 'images.pdf', 'pdf', status);
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  pdfToWord(tool) { convertOut(tool, 'pdf', (b) => folio.pdfToWord(b), 'docx'); },
  pdfToExcel(tool) { convertOut(tool, 'pdf', (b) => folio.pdfToExcel(b), 'xlsx'); },
  pdfToPpt(tool) { convertOut(tool, 'pdf', (b) => folio.pdfToPpt(b), 'pptx'); },
  wordToPdf(tool) { convertOut(tool, 'word', (b) => folio.wordToPdf(b), 'pdf'); },
  excelToPdf(tool) { convertOut(tool, 'excel', (b) => folio.excelToPdf(b), 'pdf'); },
  pptToPdf(tool) { soonPanel(tool, 'Slide layout fidelity needs a real renderer; not feasible inside an offline WebView yet. Every other conversion works.'); },

  // ── XML / XPS ──────────────────────────────────────────────────────────────
  xmlToPdf(tool) { convertOut(tool, 'xml', (b) => folio.xmlToPdf(b), 'pdf'); },
  pdfToXml(tool) { convertOut(tool, 'pdf', (b) => folio.pdfToXml(b), 'xml'); },
  xpsToPdf(tool) { convertOut(tool, 'xps', (b) => folio.xpsToPdf(b), 'pdf'); },

  pdfToXps(tool) {
    const prog = progressBar();
    const pick = pickRow({ label: 'Source PDF', accept: 'pdf', multi: false });
    const { status, body } = panelShell(tool, [pick, prog], []);
    const run = runButton('convert', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      const out = await folio.pdfToXps(pick.files[0].bytes, (p) => prog.set(p));
      await deliver(out, `${baseName(pick.files[0])}.xps`, 'xps', status);
      body.appendChild(filedStamp());
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  viewXML(tool) { openXmlViewer(tool); },
  viewXPS(tool) { openXpsViewer(tool); },

  // ── SECURE & SIGN ────────────────────────────────────────────────────────
  protectPdf(tool) { soonPanel(tool, 'PDF encryption needs a crypto layer pdf-lib does not expose yet. We will not produce a file that merely *looks* protected. Remove-password works today.'); },

  unlockPdf(tool) {
    simplePdfTool(tool, (bytes) => folio.unlock(bytes), (f) => `${baseName(f)}-unlocked.pdf`);
  },

  watermark(tool) {
    const text = el('input', { type: 'text', value: 'CONFIDENTIAL' });
    const opacity = el('input', { type: 'number', value: '18', min: '5', max: '60' });
    simplePdfTool(tool,
      (bytes) => folio.watermark(bytes, text.value || 'DRAFT', parseInt(opacity.value, 10) / 100),
      (f) => `${baseName(f)}-watermark.pdf`,
      [row('Watermark text', text), row('Opacity %', opacity)]);
  },

  pageNumbers(tool) {
    const fmt = el('input', { type: 'text', value: '{n} / {total}' });
    const pos = el('select', {},
      el('option', { value: 'bottom-center' }, 'bottom center'),
      el('option', { value: 'bottom-right' }, 'bottom right'),
      el('option', { value: 'bottom-left' }, 'bottom left'),
      el('option', { value: 'top-center' }, 'top center'),
      el('option', { value: 'top-right' }, 'top right'),
      el('option', { value: 'top-left' }, 'top left')
    );
    simplePdfTool(tool,
      (bytes) => folio.pageNumbers(bytes, fmt.value, pos.value),
      (f) => `${baseName(f)}-numbered.pdf`,
      [row('Format ({n}, {total})', fmt), row('Position', pos)]);
  },

  flatten(tool) {
    simplePdfTool(tool, (bytes) => folio.flatten(bytes), (f) => `${baseName(f)}-flat.pdf`);
  },

  signFill(tool) {
    const pageIdx = el('input', { type: 'number', value: '1', min: '1' });
    const sigWrap = el('div', { class: 'row' },
      el('label', {}, 'Draw your signature'),
      el('canvas', { id: 'sigPad' }),
      el('div', { style: 'margin-top:8px' }, el('button', { class: 'btn', id: 'sigClear' }, 'clear'))
    );
    const pick = pickRow({ label: 'PDF to sign', accept: 'pdf', multi: false });
    const { status, body } = panelShell(tool, [pick, row('Place on page #', pageIdx), sigWrap], []);
    const canvas = $('#sigPad');
    setupSignaturePad(canvas);
    $('#sigClear').addEventListener('click', () => clearSignature(canvas));
    const run = runButton('sign', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      if (isCanvasBlank(canvas)) return setStatus(status, 'draw a signature first', true);
      const png = folio._dataUrlToU8(canvas.toDataURL('image/png'));
      const out = await folio.sign(pick.files[0].bytes, png, {
        pageIndex: Math.max(0, parseInt(pageIdx.value, 10) - 1),
        width: 160, height: 60,
      });
      await deliver(out, `${baseName(pick.files[0])}-signed.pdf`, 'pdf', status);
      body.appendChild(filedStamp());
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  // ── SCAN & READ ────────────────────────────────────────────────────────────
  ocrSearchable(tool) {
    const prog = progressBar();
    const out = el('textarea', { class: 'textout', readonly: 'true', placeholder: 'Recognized text will appear here…' });
    const pick = pickRow({ label: 'Scanned PDF', accept: 'pdf', multi: false });
    const { status } = panelShell(tool, [pick, prog, row('Recognized text', out)], []);
    const run = runButton('run OCR', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      setStatus(status, 'recognising (offline)…');
      const res = await folio.ocrPdf(pick.files[0].bytes, 2, (p) => prog.set(p));
      out.value = res.text;
      // Also file a .txt sidecar so the user keeps the searchable text.
      await deliver(new TextEncoder().encode(res.text), `${baseName(pick.files[0])}-ocr.txt`, 'txt', status);
      setStatus(status, 'OCR text filed (.txt)');
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  extractText(tool) {
    const out = el('textarea', { class: 'textout', readonly: 'true', placeholder: 'Extracted text will appear here…' });
    const pick = pickRow({ label: 'PDF', accept: 'pdf', multi: false });
    const { status } = panelShell(tool, [pick, row('Extracted text', out)], []);
    const run = runButton('extract', async () => {
      if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
      const res = await folio.extractText(pick.files[0].bytes);
      out.value = res.text || '(no embedded text — try OCR for scans)';
      await deliver(new TextEncoder().encode(res.text || ''), `${baseName(pick.files[0])}.txt`, 'txt', status);
    }, status);
    $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
  },

  viewPDF(tool) { openViewer(tool); },
};

// "pick file of type → fn → save as kind" convert helper
function convertOut(tool, accept, fn, kind) {
  const pick = pickRow({ label: `Source ${accept === 'pdf' ? 'PDF' : accept}`, accept, multi: false });
  const { status, body } = panelShell(tool, [pick], []);
  const run = runButton('convert', async () => {
    if (!pick.files.length) return setStatus(status, 'choose a file', true);
    const out = await fn(pick.files[0].bytes);
    await deliver(out, `${baseName(pick.files[0])}.${kind}`, kind, status);
    body.appendChild(filedStamp());
  }, status);
  $('#panel .actions').insertBefore(run, $('#panel .actions').firstChild);
}

function soonPanel(tool, note) {
  panelShell(tool, [el('p', { class: 'panel-blurb', style: 'padding:8px 0 4px' }, note)], []);
}

// ── PDF viewer (paged raster) ─────────────────────────────────────────────────

// Render already-in-hand PDF bytes into the paged viewer.
async function showPdfInViewer(panel, label, pdfBytes) {
  const geo = await folio.geometry(pdfBytes);
  panel.innerHTML = '';
  const pagesWrap = el('div', { class: 'viewer-pages' });
  const vlabel = el('span', { class: 'vlabel' }, label);
  const vmeta = el('span', { class: 'vmeta' }, `${geo.pageCount} page${geo.pageCount === 1 ? '' : 's'}`);
  const bar = el('div', { class: 'viewer-bar' }, vlabel, vmeta,
    el('span', { style: 'margin-left:auto' }, el('button', { class: 'btn ghost', onclick: closePanel }, 'close')));
  panel.appendChild(el('div', { class: 'viewer' }, bar, pagesWrap));
  // Lazy-render pages as we go (keeps memory sane on phones).
  for (let i = 0; i < geo.pageCount; i++) {
    const r = await folio.renderPage(pdfBytes, i, 1.4);
    if (r) pagesWrap.appendChild(el('img', { src: r.dataUrl, alt: `page ${i + 1}` }));
  }
}

async function openViewer(tool) {
  const pick = pickRow({ label: 'PDF to view', accept: 'pdf', multi: false });
  const { status, panel } = panelShell(tool, [pick], []);
  const open = runButton('open', async () => {
    if (!pick.files.length) return setStatus(status, 'choose a PDF', true);
    await showPdfInViewer(panel, pick.files[0].name, pick.files[0].bytes);
  }, status);
  $('#panel .actions').insertBefore(open, $('#panel .actions').firstChild);
}

// View XPS — render via the XPS → PDF path, then show in the PDF viewer.
async function openXpsViewer(tool) {
  const pick = pickRow({ label: 'XPS to view', accept: 'xps', multi: false });
  const { status, panel } = panelShell(tool, [pick], []);
  const open = runButton('open', async () => {
    if (!pick.files.length) return setStatus(status, 'choose an XPS', true);
    setStatus(status, 'rendering…');
    const pdfBytes = await folio.viewXps(pick.files[0].bytes);
    await showPdfInViewer(panel, pick.files[0].name, pdfBytes);
  }, status);
  $('#panel .actions').insertBefore(open, $('#panel .actions').firstChild);
}

// View XML — parse + pretty-print, show in a <pre> block.
function openXmlViewer(tool) {
  const out = el('pre', { class: 'textout', style: 'white-space:pre; overflow:auto; max-height:60vh' });
  const pick = pickRow({ label: 'XML to view', accept: 'xml', multi: false });
  const { status } = panelShell(tool, [pick, row('Formatted XML', out)], []);
  const open = runButton('open', async () => {
    if (!pick.files.length) return setStatus(status, 'choose an XML file', true);
    out.textContent = folio.viewXml(pick.files[0].bytes);
    setStatus(status, 'formatted');
  }, status);
  $('#panel .actions').insertBefore(open, $('#panel .actions').firstChild);
}

// ── signature pad ──────────────────────────────────────────────────────────

function setupSignaturePad(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = () => canvas.getBoundingClientRect();
  const resize = () => {
    const r = rect();
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#28231E';
  };
  requestAnimationFrame(resize);
  let drawing = false;
  const pos = (e) => {
    const r = rect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const ctx = canvas.getContext('2d');
  const start = (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
  const end = () => { drawing = false; canvas.__hasInk = true; };
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', end);
}
function clearSignature(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.__hasInk = false;
}
function isCanvasBlank(canvas) { return !canvas.__hasInk; }

// ── theme + welcome ──────────────────────────────────────────────────────────

const THEME_KEY = 'folio.theme';
const WELCOME_KEY = 'folio.welcomed';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#themeToggle').textContent = theme === 'night' ? 'day edition' : 'night edition';
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

function initWelcome() {
  let seen = false;
  try { seen = localStorage.getItem(WELCOME_KEY) === '1'; } catch (_) {}
  const w = $('#welcome');
  if (!seen) {
    w.style.display = 'flex';
    $('#welcomeStart').addEventListener('click', () => {
      w.style.display = 'none';
      try { localStorage.setItem(WELCOME_KEY, '1'); } catch (_) {}
    });
  } else {
    w.style.display = 'none';
  }
}

// ── boot ─────────────────────────────────────────────────────────────────────

function boot() {
  let theme = 'day';
  try { theme = localStorage.getItem(THEME_KEY) || 'day'; } catch (_) {}
  applyTheme(theme);
  $('#themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'night' ? 'day' : 'night');
  });
  $('#scrim').addEventListener('click', (e) => { if (e.target === $('#scrim')) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  buildDesks();
  initWelcome();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
