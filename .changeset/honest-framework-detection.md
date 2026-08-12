---
"@zintljs/compiler": minor
"zintljs": minor
---

Framework detection no longer guesses React when it finds nothing (ledger L-034).

`detectFrameworksOrFallback` returned `FALLBACK_FRAMEWORK` — `"react"` — for any project where neither the bundler plugin names nor `package.json` named a framework. That was not a neutral default: a project with no React dependency was assembled with React extraction and codegen, and because `reactCodegenFacet` is the only preset declaring `clientReactivityImports`, every project in existence reported having client reactivity. It also meant any runtime constraint attached to the React facet reached every framework-less project, which is why one previous attempt to mark React's entry re-execution unsafe had to be reverted.

**What the guess was carrying was two extraction targets.** `obj:field:title` and `obj:field:text` were listed by `reactExtractionFacet` and not by `vanillaFacet`, so framework-less projects using those object fields had been depending on React extraction they never asked for. Both are plain object-field extraction with nothing React-specific about them, and they now live on the vanilla facet, which applies to every project.

**Breaking:** `zintljs/facets` no longer exports `FALLBACK_FRAMEWORK` or `detectFrameworksOrFallback`. Use `detectFrameworks`, which returns an empty array when nothing matched — a real answer rather than a prompt for a guess. A project that uses a framework should declare it in `dependencies`/`devDependencies` or through its bundler plugin, both of which detection already reads.
