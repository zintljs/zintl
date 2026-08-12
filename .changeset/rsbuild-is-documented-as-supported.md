---
"zintljs": patch
---

Say what `zintljs/rsbuild` actually is.

The entry point has been a supported way to build a single-page app since proposal 029, in production
builds and in dev. Its own module doc still said the opposite — "not a supported target", "hot updates
not attempted" — which is the text that shows on hover, and both READMEs still described Zintl as
Vite-only.

All of it now reflects the code: Rsbuild sits beside Vite as an optional peer dependency, `multiplex`
and SSR are named as Vite-only rather than left to be discovered, and the dev-time behaviour is
described by its rule — an app whose components re-read the catalog updates in place, one without
them reloads — instead of by whichever example was measured last.

The publish smoke gate also runs against `zintljs/rsbuild` now, not just `zintljs/vite`, so a
consumer's `npm install` of the Rsbuild entry point is exercised before a release rather than after.
