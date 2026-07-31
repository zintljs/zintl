---
"@zintljs/compiler": patch
"zintljs": patch
---

Fixed HMR rendering issues and resolved timing race conditions during source translation updates:

- Updated the translation resolver (`_t`) to immediately re-evaluate catalog lookups after synchronous self-registration, preventing blank rendering.
- Propagated HMR timestamps (`lastHMRTimestamp`) on all invalidated virtual modules in `handleHotUpdate` to ensure Vite's `importAnalysis` rewrites imports with correct timestamp query parameters.
- Introduced automated page auto-refresh (full-reload) for server-side (SSR) only boundaries and catalogs when modified.
