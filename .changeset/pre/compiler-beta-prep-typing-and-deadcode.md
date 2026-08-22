---
"@zintljs/compiler": minor
"zintljs": patch
---

Beta-prep pass on the compiler: dead code removed, `any` usage cut from 252 to 141 occurrences (all internal — the compiler's public surface is now fully typed except one genuinely-dynamic disk-read catalog value).

**Dead/redundant code removed:**

- Leftover commented-out debug scaffolding in `ZintlCompiler`.
- A duplicated HMR self-accept snippet (the no-facet fallback re-implemented, and slightly diverged from, `viteFacet()`'s own logic) — consolidated into one shared helper.
- A redundant `pipeline/types.ts` barrel that re-exported the exact same thing as `src/types.ts`.
- ~16 independent copies of the Windows-path-normalization idiom (`.replace(/\\/g, "/")`) and 3 copies of the monorepo-example-detection check, each consolidated into one shared utility.
- Pruned unused public exports with zero consumers anywhere in the monorepo: `DeliveryBus`, `DeliveryBusOptions`, `DeliveryChannel`, `DeliveryLedgerEntry`, `DeliveryOutcome`, `Envelope`, `TerminalOutcome`, a duplicate `ZintlLogger` re-export, and `similarity`/`sortObjectKeys`/`compareStrings`. Implementations are untouched — only the public re-export is gone, since nothing outside the package's own internals imported them by name.

**`any` → real types**, working from the root cause outward (`MessageManager`'s untyped graph/manifest fields cascaded `any` through `GraphManager`, `CatalogManager`, `CompilerContext`, and `ZintlCompiler` itself) rather than annotating each call site independently:

- Fixed `types/graph.ts`'s `DependencyGraph` alias, which had been defined against the wrong upstream type (`@zintljs/extractor`'s `BoundaryDep`, optional `bindings`) when every real consumer needs the compiler's own `ObservedDependency` (required `bindings`) — a latent type-definition bug the `any` had been quietly hiding.
- `MessageManager`, `GraphManager`, `CatalogManager`, `IOManager`, `CompilerContext`, and `ZintlCompiler` now use the domain vocabulary that already existed (`Manifest`, `DependencyGraph`, `MetadataGraph`, `BoundaryGraph`, `ChunkGraph`, `CompilerContext`, `CatalogFormatContext`, `ZintlLogger`, magic-string's `SourceMap`) instead of `any`.
- Facet hooks with genuinely per-facet dynamic state (`ContentFacet.setup`/`getStateToSave`/`getManagerInstance`) now return `unknown` rather than `any` — honest about being untyped without inventing a new abstraction.
- `ZintlCompiler.assets`/`.html` (typed `unknown`, correctly — the compiler core cannot know about specific facets) surfaced ~40 call sites in `zintljs` that were relying on `any`'s silence to treat them as concretely-shaped objects. Exported the two previously-private manager classes (`AssetManager`, `HtmlManager`) as types from `@zintljs/compiler/facets` so those call sites can narrow honestly instead.

Remaining `any` usage is concentrated in `pipeline/*` internals, `runtime/*` (served as text to the browser, not part of the public `exports` map), `facet/presets/{html,assets}.ts`, and a handful of genuinely-dynamic disk-read catalog/schema values with no existing type to reuse — left as a deliberate follow-up rather than inventing new types under this pass.
