---
"@zintljs/extractor": patch
"@zintljs/compiler": patch
---

Fully decoupled high-level framework presets (`"vue"`, `"svelte"`, and `"nextjs"`) from `@zintljs/extractor`'s core logic. The extractor has no hardcoded references to these framework target-presets, meaning all SFC block parsing rules, metadata suppression rules, and mustache regular expression patterns now flow downward from compiler-resolved adapters.

Evolved the extractor's mustache rule matcher to dynamically match intermediate or virtual file extensions (e.g. `.vue.html` and `.svelte.html`) to ensure correct template variable extraction and production catalog baking in Vue and Svelte.
