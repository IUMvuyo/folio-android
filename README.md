# Folio — Private Edition (Android & Huawei AppGallery)

Every PDF tool, **100% on your device. No network, ever.**

Folio is a private, offline PDF toolkit with an editorial / newspaper look. This
is the Android build — and because Folio uses **zero Google services**, the same
plain `.apk` installs on any Android phone *and* on Huawei (HMS) devices with no
Google Play at all. The `.aab` is for Google Play.

It is built with **Capacitor**, wrapping the same browser-compatible web stack
(pdf-lib, pdfjs-dist, tesseract.js, docx, exceljs, pptxgenjs, mammoth) used by
the Electron Windows edition. The Electron/Node-only bits (IPC dialogs,
`webContents.printToPDF`, `nativeImage`) were adapted to run inside the WebView.

## Privacy is the product

- **No `INTERNET` permission.** Capacitor adds it by default; we deleted it. With
  no INTERNET permission the OS itself blocks any network attempt — the strongest
  possible offline guarantee.
- **No Google services / Firebase / GMS / analytics**, anywhere — not even the
  build-time `google-services` classpath. That is also why it runs on Huawei.
- Everything offline runs against **bundled local assets**: the pdf.js worker,
  the tesseract.js worker + WASM core, and the English OCR model
  (`eng.traineddata.gz`) all ship inside the APK and are pointed at local file
  URLs. Tesseract never fetches language data.
- File import/export uses the system **document picker** + **share sheet** (local
  IPC), not the network. Exports are written to `Documents/Folio/`.

## Features

The four desks mirror the iOS edition (`Folio/Models/FolioTool.swift`).

| Desk | Tool | Status |
|------|------|--------|
| Organize | Merge, Split, Rotate, Delete pages, Extract pages | ✅ works |
| Organize | Compress (structural + aggressive image re-encode) | ✅ works |
| Convert | PDF → Images (PNG/JPG) | ✅ works |
| Convert | Images → PDF | ✅ works |
| Convert | PDF → Word / Excel / PowerPoint | ✅ works (best-effort text) |
| Convert | Word → PDF, Excel → PDF | ✅ works (pure-JS layout into pdf-lib) |
| Convert | PowerPoint → PDF | 🚧 coming soon (needs a slide renderer) |
| Secure & Sign | Remove Password, Watermark, Page Numbers, Sign & Fill, Flatten | ✅ works |
| Secure & Sign | Password Protect | 🚧 coming soon (pdf-lib has no encryption API) |
| Scan & Read | Make Searchable (OCR) — offline tesseract | ✅ works |
| Scan & Read | Extract Text, View PDF | ✅ works |

The two "coming soon" tools are marked clearly in the UI and never fall back to a
cloud/network path. Office → PDF is a best-effort **pure-JS** render (no Chromium
`printToPDF` exists in a WebView), so it captures text/tables, not pixel-perfect
original styling.

## Build locally

Requires Node 20+, JDK 17, and the Android SDK.

```bash
npm ci
npm run build        # bundle web + copy offline assets into www/
npx cap sync android # copy www/ into the native project
cd android
./gradlew assembleRelease   # → android/app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease      # → android/app/build/outputs/bundle/release/app-release.aab
```

Signing: if `FOLIO_KEYSTORE_FILE` (+ password/alias env vars) is set, the release
is signed with it; otherwise `build.gradle` falls back to the **debug** signing
config so the release APK is still installable. CI generates a throwaway keystore
(or uses the `FOLIO_KEYSTORE_BASE64` secret if present).

The web layer can be exercised without the Android SDK: `npm run build` produces
`www/`, and the pure pdf-lib engine is plain JS.

## CI

`.github/workflows/android.yml` runs on `ubuntu-latest`: JDK 17 + Android SDK →
`npm ci` → `npm run build` → `npx cap sync android` → `./gradlew assembleRelease
bundleRelease` → uploads the APK/AAB as artifacts **and** publishes them to a
GitHub **Release v1.0.0** (delete-then-create for idempotency).
