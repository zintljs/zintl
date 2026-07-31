---
"@zintljs/compiler": minor
"zintl": minor
"@zintljs/extractor": minor
---

Decoupled the runtime by relocating it from the Vite plugin and the old runtime packages directly into the compiler. The Vite plugin now dynamically resolves and loads the runtime (only when needed) as a virtualized module served from compiler-generated assets, while `zintl/macro` has been streamlined as a lean, zero-dependency facade.
