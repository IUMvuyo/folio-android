// folio.js — single esbuild entry point. Pulls in the renderer UI, which in
// turn imports the bridge and every engine, producing one IIFE bundle
// (www/folio.bundle.js) loaded by index.html. Everything is bundled locally;
// no module is fetched at runtime (the privacy guarantee).
import './app.js';
