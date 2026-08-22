---
"@zintljs/compiler": patch
---

The document now announces the locale the store actually adopted, on every host.

Zintl publishes a locale change to `<html lang>` by calling `window.__zintlApplyHtml`, which is installed by the HTML projection script — and that script is injected through `transformIndexHtml`, a Vite-only hook. On any other bundler no projection exists, so a page could switch locale, render the new language, and go on announcing the old one to assistive technology and search engines.

`publishLocale` now sets `document.documentElement.lang` itself when no projection is installed. The store always knows the locale it adopted, so it can say so unaided, and the branch runs only when nothing better is present — the projection keeps full ownership wherever it exists.

`dir` is deliberately not handled here. Direction is per-locale data the projection reads out of catalogs at build time; giving the runtime its own table would put a list of RTL languages in the compiler core, which is knowledge that belongs to a facet.
