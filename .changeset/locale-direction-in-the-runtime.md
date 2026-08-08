---
"@zintljs/compiler": minor
"zintljs": patch
---

Made `<html dir>` follow the active locale on any host, and fixed two defects that stopped it following reliably on Vite.

Direction used to reach the document only through the HTML projection, which Zintl injects via `transformIndexHtml` — a Vite hook that unplugin drops everywhere else. The runtime had no direction data of its own and deliberately set only `lang`.

It now has the data. `ContentFacet.rtlLocales` is a new hook, unioned by `ZintlCompiler.getRtlLocales()` and substituted into the generated runtime as a literal array, so the store can set `dir` wherever it already sets `lang`. Core learns nothing about direction or about RTL languages: it merges string arrays that facets return. The HTML facet answers by reading the `dir` field already written into every HTML catalog — so this is one derivation moved to where two consumers can share it, not a new source of truth, and there is no list of RTL languages anywhere in the runtime.

**Two defects fixed on the supported path**, which together explain why adding an HTML catalog to a page could stop `lang` updating:

- The projection's `apply()` returned early when `lang` already matched the target locale — but it owns `dir` as well, so anything that set `lang` first permanently locked `dir` out with no way to correct it. Every statement in that function is an idempotent assignment, so the guard bought nothing.
- The store's own attribute handling was an `else` branch behind `window.__zintlApplyHtml`. The projection installs that function unconditionally but writes `dir` only when the project has an RTL locale, so on every other project it took ownership of the document and then declined to finish the job, silently suppressing the fallback. The two now run in sequence: the store owns `lang` and `dir`, the projection owns the document-specific title, description and body deltas.

`dir` is written only when the project actually has direction data. Empty means "this project never spoke about direction", and asserting `"ltr"` there would start writing an attribute onto documents that never had one.

**Removed: the dead `sourceLocale` field on `I18nStore`.** It was written by a build-time substitution and never read — the only occurrence in the whole runtime was its own declaration — and it shipped in every production bundle. Its substitution was also the fragile kind: a regex matching a TypeScript class-field default, one `readonly` keyword or formatter change away from silently matching nothing. `getRuntimeCode` drops its `sourceLocale` parameter and gains `rtlLocales`, which uses the same word-boundary sentinel mechanism as `__ZINTL_DEV__`.
