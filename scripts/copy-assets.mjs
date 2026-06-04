// copy-assets.mjs — assemble the web root (www/) that Capacitor ships inside the
// APK. Everything is local; NOTHING is fetched at runtime. We copy:
//   • the static HTML/CSS (www-static/)
//   • the pdf.js worker  (pdfjs-dist/build/pdf.worker.min.mjs)
//   • the tesseract.js worker + wasm core + the bundled eng language model
// The esbuild bundle (folio.bundle.js) is produced by the `bundle` script.

import { mkdir, copyFile, cp, access } from 'node:fs/promises';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const nm = join(root, 'node_modules');

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function copy(src, dest, label) {
  if (!(await exists(src))) {
    throw new Error(`MISSING required asset: ${src} (for ${label})`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log('Assembling www/ …');
  await mkdir(www, { recursive: true });

  // 1) static shell
  await cp(join(root, 'www-static'), www, { recursive: true });
  console.log('  ✓ static shell (index.html, styles.css)');

  // 2) pdf.js worker (the renderEngine points GlobalWorkerOptions.workerSrc here)
  await copy(
    join(nm, 'pdfjs-dist/build/pdf.worker.min.mjs'),
    join(www, 'pdf.worker.min.mjs'),
    'pdf.js worker'
  );

  // 3) tesseract.js worker
  await copy(
    join(nm, 'tesseract.js/dist/worker.min.js'),
    join(www, 'tess/worker.min.js'),
    'tesseract worker'
  );

  // 4) tesseract core (SIMD wasm + its js loader, and a non-SIMD fallback).
  //    tesseract.js picks the variant from corePath at runtime; ship the full
  //    set so it works on any device, fully offline.
  const coreDir = join(nm, 'tesseract.js-core');
  for (const f of [
    'tesseract-core-simd.wasm',
    'tesseract-core-simd.wasm.js',
    'tesseract-core.wasm',
    'tesseract-core.wasm.js',
    'tesseract-core-simd-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
    'tesseract-core-lstm.wasm.js',
  ]) {
    await copy(join(coreDir, f), join(www, 'tess', f), `tess core ${f}`);
  }

  // 5) the bundled English language model (gzipped). Sourced from the existing
  //    Folio-Windows assets so we keep one canonical copy. Falls back to a local
  //    copy in this repo if present.
  const langCandidates = [
    join(root, 'assets/lang/eng.traineddata.gz'),
    join(root, '..', 'Folio-Windows', 'assets', 'lang', 'eng.traineddata.gz'),
  ];
  let langSrc = null;
  for (const c of langCandidates) if (await exists(c)) { langSrc = c; break; }
  if (!langSrc) {
    throw new Error(
      'MISSING eng.traineddata.gz — expected at assets/lang/ (committed) ' +
      'or ../Folio-Windows/assets/lang/. OCR cannot ship without it.'
    );
  }
  // IMPORTANT: the Android Gradle/AAPT packaging step auto-DECOMPRESSES `.gz`
  // assets and stores them under the bare name (eng.traineddata.gz →
  // eng.traineddata). That would 404 a gzip:true tesseract load. So we ship the
  // DECOMPRESSED model ourselves as eng.traineddata and tell tesseract gzip:
  // false. app/build.gradle adds noCompress "traineddata" so AAPT leaves it as
  // is. (On web/dev this same decompressed file works too.)
  const langOut = join(www, 'tess/lang/eng.traineddata');
  await mkdir(dirname(langOut), { recursive: true });
  await pipeline(createReadStream(langSrc), createGunzip(), createWriteStream(langOut));
  console.log('  ✓ eng language model (decompressed for offline OCR)');

  console.log('www/ assembled.');
}

main().catch((e) => { console.error('\nASSET COPY FAILED:', e.message); process.exit(1); });
