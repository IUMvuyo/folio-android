// shims.js — tiny browser shims injected at the top of the bundle.
//
// Some dependencies (pptxgenjs bundles bluebird + JSZip in a browserify UMD)
// reference `process` and `global` at module scope. The Android WebView has
// neither, so without these a bare `process.browser` read would throw a
// ReferenceError before our code runs. These shims are LOCAL no-ops — they add
// NO capability and make NO network calls; they just stop the crash.

if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis;
}
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    browser: true,
    env: {},
    version: '',
    versions: {},
    platform: 'browser',
    nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
    cwd: () => '/',
  };
}
