'use strict';
// Engine launcher: `node engine-boot.js <zcode.cjs> app-server --stdio`.
// Turns on V8's on-disk compile cache for the 15 MB engine bundle, then runs
// the bundle exactly as if node had started it (argv[1] is the engine).
// Measured on 0.16.9: an engine start to session/create drops from
// ~750-900 ms to ~600 ms once the cache is warm.
//
// The cache dir arrives in ZCODE_COMPILE_CACHE and is removed from the env
// before the engine runs, so the commands the engine's tools spawn (the
// user's own node programs) never inherit it. NODE_COMPILE_CACHE would.
const mod = require('node:module');
const path = require('node:path');

const cacheDir = process.env.ZCODE_COMPILE_CACHE;
delete process.env.ZCODE_COMPILE_CACHE;
const engine = path.resolve(process.argv[2]);
process.argv.splice(1, 2, engine);

let caching = false;
if (cacheDir && typeof mod.enableCompileCache === 'function') {
  try {
    const res = mod.enableCompileCache(cacheDir);
    caching = !res || res.status !== mod.constants?.compileCacheStatus?.FAILED;
  } catch {
    /* no cache: the engine just compiles from scratch */
  }
}

require(engine);

// The engine never exits on its own: zcode-agent SIGKILLs its process group,
// and a killed process never writes its cache. Flush once startup compiled.
if (caching && typeof mod.flushCompileCache === 'function') {
  setTimeout(() => {
    try {
      mod.flushCompileCache();
    } catch {
      /* best-effort */
    }
  }, 1000).unref();
}
