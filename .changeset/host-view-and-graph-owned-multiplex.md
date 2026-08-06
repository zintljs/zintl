---
"@zintljs/compiler": minor
"zintljs": minor
---

Moved compiler construction and multiplex propagation off the bundler's plugin context, so both are answerable without a Rollup-shaped host. This is the first phase of proposal 026, which uses a second build tool as a falsification harness for the claim that the compiler is bundler-agnostic.

- **Compiler construction is no longer a Vite-only hook.** `detect → assemble → resolve → construct` moved into a new `host.ts` behind an idempotent `ensureCompiler(ctx, host)`, keyed on a small `BundlerHostView` (`root`, `isDev`, `isSsr`, `pluginNames`, `logLevel`). `configResolved` now only translates Vite's `ResolvedConfig` into that view; `buildStart`, `resolveId`, `load` and `transform` call it defensively. Previously the compiler was assigned in `configResolved` alone — a hook unplugin drops entirely on every non-Vite target, so the plugin would load and then fail on `undefined` at the first resolution.

- **Multiplex propagation asks the graph instead of walking it.** The 58-line translation-neutrality closure inside `resolveId` — which reached into `metadataGraph`, `internalManifest` and `dependencyGraph` one import edge at a time — is replaced by `ZintlCompiler.isTranslationNeutral()`, backed by a new `GraphManager.hasTranslatableContent()`. The knowledge was always the compiler's; the resolver was rediscovering it per edge while consulting the very structure that had the answer.

- **Deleted the static extension allow-list** that gated multiplex propagation (`js`, `jsx`, `ts`, `tsx`, `md`, `txt`, `vue`, `svelte`). It was app-agnostic — a Vue-only project paid for `.svelte`, and a facet contributing a new extension was silently skipped — and it was answering "might this file contain strings" where the graph can answer "is this module inside translated content". Nothing replaced it.

Note that `hasTranslatableContent` is deliberately **not** `leadsToBoundary`: the latter asks whether a file reaches a trust anchor (locale ownership), while multiplexing needs to know whether it reaches translatable content (payload). A component holding strings but declaring no anchor answers differently to the two, so reusing the existing method would have silently dropped its translations.

No behaviour change on Vite.
