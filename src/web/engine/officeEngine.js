// officeEngine — PDF ↔ Office, all on-device, no network.
//
//   PDF → Word/Excel/PPT : write OOXML with docx / exceljs / pptxgenjs. These
//                          are pure JS and run unchanged in the WebView.
//   Office → PDF         : the Electron build printed HTML→PDF via Chromium's
//                          webContents.printToPDF, which DOES NOT exist in a
//                          WebView. So here we do a best-effort PURE-JS render
//                          straight into pdf-lib:
//                            • Word  → mammoth extracts raw text, we lay out
//                                      wrapped paragraphs onto A4 pages.
//                            • Excel → exceljs reads rows, we draw a simple
//                                      monospace table grid onto A4 pages.
//                            • PPT   → not feasible in-WebView with fidelity;
//                                      surfaced as "coming soon" (throws SOON).
//
// No file ever leaves the device.

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import * as mammoth from 'mammoth/mammoth.browser.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { extractText } from './renderEngine.js';

// ── PDF → Office (write OOXML) ───────────────────────────────────────────────

/** PDF → Word (.docx): extract text per page, write paragraphs. Best-effort. */
export async function pdfToWord(pdfBytes) {
  const { pages } = await extractText(pdfBytes);
  const children = [];
  pages.forEach((pageText, idx) => {
    if (idx > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Page ${idx + 1}`, bold: true, color: 'C02423' })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        })
      );
    }
    for (const line of pageText.split('\n')) {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  });
  const doc = new Document({
    creator: 'Folio — Private Edition',
    title: 'Converted from PDF',
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
  // In the browser, Packer.toBlob is available; normalize to Uint8Array.
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/** PDF → Excel (.xlsx): one row per text line; naive column split on 2+ spaces. */
export async function pdfToExcel(pdfBytes) {
  const { pages } = await extractText(pdfBytes);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Folio — Private Edition';
  pages.forEach((pageText, idx) => {
    const ws = wb.addWorksheet(`Page ${idx + 1}`);
    for (const line of pageText.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split(/\s{2,}|\t/).map((c) => c.trim());
      ws.addRow(cols);
    }
  });
  if (wb.worksheets.length === 0) wb.addWorksheet('Sheet1');
  const ab = await wb.xlsx.writeBuffer();
  return new Uint8Array(ab);
}

/** PDF → PowerPoint (.pptx): one slide per page with that page's text. */
export async function pdfToPpt(pdfBytes) {
  const { pages } = await extractText(pdfBytes);
  const pptx = new PptxGenJS();
  pptx.author = 'Folio — Private Edition';
  pptx.defineLayout({ name: 'A4', width: 10, height: 7.5 });
  pptx.layout = 'A4';
  if (pages.length === 0) pages.push('');
  pages.forEach((pageText, idx) => {
    const slide = pptx.addSlide();
    slide.addText(`Page ${idx + 1}`, {
      x: 0.4, y: 0.2, w: 9.2, h: 0.5, fontFace: 'Georgia', fontSize: 18, bold: true, color: 'C02423',
    });
    slide.addText(pageText || '(no extractable text)', {
      x: 0.4, y: 0.8, w: 9.2, h: 6.4, fontFace: 'Georgia', fontSize: 12,
      color: '28231E', valign: 'top',
    });
  });
  const ab = await pptx.write({ outputType: 'arraybuffer' });
  return new Uint8Array(ab);
}

// ── Office → PDF (pure-JS layout into pdf-lib — no Chromium printToPDF) ───────

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 54; // ~19mm

/** Wrap a line of text to a max width given a pdf-lib font + size. */
function wrapLine(text, font, size, maxWidth) {
  if (text === '') return [''];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      // Hard-break a single word that's wider than the column.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            if (chunk) lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        cur = chunk;
      } else {
        cur = word;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Lay out an array of paragraph strings onto A4 pages. */
async function paragraphsToPdf(paragraphs, { title } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const size = 11;
  const lead = 15;
  const colW = A4.w - MARGIN * 2;

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  const newPage = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - MARGIN;
  };

  if (title) {
    page.drawText(title, { x: MARGIN, y: y - 16, size: 16, font: bold, color: rgb(0.16, 0.14, 0.12) });
    y -= 16 + lead * 1.4;
  }

  for (const para of paragraphs) {
    const lines = wrapLine(String(para ?? ''), font, size, colW);
    for (const line of lines) {
      if (y - lead < MARGIN) newPage();
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color: rgb(0.16, 0.14, 0.12) });
      y -= lead;
    }
    y -= lead * 0.4; // paragraph gap
  }
  return doc.save();
}

/** Word (.docx) → PDF. Best-effort: extracts text, lays it out on A4. */
export async function wordToPdf(docxBytes) {
  const ab = docxBytes instanceof Uint8Array ? docxBytes.slice().buffer : docxBytes;
  const { value } = await mammoth.extractRawText({ arrayBuffer: ab });
  const paras = (value || '(empty document)').split(/\n/);
  return paragraphsToPdf(paras, { title: 'Document' });
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return String(v);
}

/** Excel (.xlsx) → PDF. Best-effort: draws each sheet's rows as a text grid. */
export async function excelToPdf(xlsxBytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBytes instanceof Uint8Array ? xlsxBytes.slice().buffer : xlsxBytes);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 9;
  const lead = 13;
  const colW = A4.w - MARGIN * 2;

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = A4.h - MARGIN; };
  const ensure = (h) => { if (y - h < MARGIN) newPage(); };

  wb.eachSheet((ws) => {
    ensure(lead * 2);
    page.drawText(ws.name, { x: MARGIN, y: y - 12, size: 12, font: bold, color: rgb(0.75, 0.14, 0.13) });
    y -= lead * 1.6;

    ws.eachRow((row) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      const maxCol = Math.max(vals.length, ws.columnCount || 0) || 1;
      const cellW = colW / maxCol;
      ensure(lead);
      let x = MARGIN;
      for (let c = 0; c < maxCol; c++) {
        const cell = row.getCell(c + 1);
        let txt = cell && cell.value != null ? cellText(cell.value) : '';
        // truncate to fit the column
        while (txt && font.widthOfTextAtSize(txt, size) > cellW - 4) txt = txt.slice(0, -1);
        page.drawText(txt, { x: x + 2, y: y - size, size, font, color: rgb(0.16, 0.14, 0.12) });
        x += cellW;
      }
      y -= lead;
    });
    y -= lead;
  });

  if (doc.getPageCount() === 0) doc.addPage([A4.w, A4.h]);
  return doc.save();
}

/** PowerPoint → PDF — not feasible in-WebView with fidelity. */
export async function pptToPdf() {
  throw new Error('SOON');
}
