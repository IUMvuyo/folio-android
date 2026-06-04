// ocrEngine — Tesseract OCR, 100% offline in the Android WebView.
// EVERYTHING tesseract.js could otherwise fetch from a CDN is bundled into the
// APK and pointed at local file URLs:
//   • workerPath  → tess/worker.min.js          (copied from tesseract.js/dist)
//   • corePath    → tess/                         (tesseract-core wasm, copied)
//   • langPath    → tess/lang/                    (eng.traineddata.gz, bundled)
// gzip:true because our language file is the gzipped model. cacheMethod:'none'
// so it never tries to write/read an IndexedDB cache that could imply a fetch.
// Verified: with these three local paths set, tesseract.js issues ZERO network
// requests — it works fully air-gapped.

import { createWorker } from 'tesseract.js';

function base() {
  return document.baseURI; // the app's local origin inside the WebView
}

function localPaths() {
  return {
    workerPath: new URL('tess/worker.min.js', base()).href,
    corePath: new URL('tess/', base()).href,
    langPath: new URL('tess/lang/', base()).href,
  };
}

/** OCR a single image (PNG/JPG bytes or a data URL). Returns {text, words, confidence}. */
export async function ocrImage(image, { lang = 'eng', onProgress } = {}) {
  const { workerPath, corePath, langPath } = localPaths();
  const worker = await createWorker(lang, 1, {
    workerPath,
    corePath,
    langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text, words: data.words || [], confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}

/** OCR a sequence of page images (already rasterized). onProgress(0..1). */
export async function ocrPages(pageImages, { lang = 'eng', onProgress } = {}) {
  const { workerPath, corePath, langPath } = localPaths();
  const worker = await createWorker(lang, 1, {
    workerPath,
    corePath,
    langPath,
    gzip: true,
    cacheMethod: 'none',
  });
  const results = [];
  try {
    for (let i = 0; i < pageImages.length; i++) {
      const { data } = await worker.recognize(pageImages[i].image);
      results.push({
        text: data.text,
        words: data.words || [],
        width: pageImages[i].width,
        height: pageImages[i].height,
      });
      if (onProgress) onProgress((i + 1) / pageImages.length);
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
