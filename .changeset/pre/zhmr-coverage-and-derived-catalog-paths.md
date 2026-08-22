---
"@zintljs/testing": patch
---

Hot-update contracts cover what ZHMR specifies, and stop guessing where files live.

Most of `docs/spec/ZHMR.md` had no contract behind it. Nothing edited a translation catalog and
checked the page followed — the most common thing anyone does with an i18n toolchain. Nothing edited
a static asset, so §5's `b_assets` cascade was unobserved on both hosts. Nothing edited a server-only
boundary, so §4.3's full-reload broadcast was specified, implemented and never executed. Nothing
distinguished a change that fits the boundary graph from one that reshapes it (§4.1③ vs §4.2). And
because every assertion polls with `textEventually`, a heading that flashed empty mid-update — ZHMR
§6's named failure mode — polled green.

Five contracts close that: `catalog-edit`, `asset-hmr`, `hmr-server-refresh`, `hmr-growth` and
`hmr-first-tick`. Three new capabilities carry the claims that need a per-project answer —
`asset-hmr`, `hmr-server-refresh` and `hmr-structural` — each earned only with the matching adapter
field declared, the relationship `chaos` already had with `renameBoundary`.

**Hot updates are no longer gated on `spa`.** Every HMR contract required `["spa", "hmr"]`, and `spa`
was doing no work `hmr` did not already do — what it did instead was exclude SSR by accident, so
`react-ssr` carried a `hmr` capability that selected zero tests. Hot updates are not a property of
client-side routing.

**Three places guessed at paths a compiler had already resolved**, and all three are now asked rather
than assumed, via `findCatalogFor` and `localizedAssetPath`:

- `chaos-catalog` tried `src/i18n/translations.json`, then walked `zintl/`, and threw otherwise. It
  had never heard of `src/locales`, where every Rsbuild example keeps catalogs — so `chaos` was
  unclaimable on eight projects because the contract could not find files that were sitting there.
- `noOrphanedCatalogs` read `(lab.compiler as any).outputDir ?? "src/locales"`, and `LabCompiler` has
  no `outputDir`: the left side was always `undefined`. Not one project claiming `chaos` uses
  `src/locales`, so the directory never existed and the assertion **returned without checking
  anything, on every project, for its whole life**.
- `catalogContains` joined `<root>/<options.outputDir ?? "locales">/<locale>.json`, a flat layout no
  project here uses, through a property the compiler does not expose.

`performance-size` filtered catalog responses by four hardcoded Vite URL shapes and so could only
ever measure zero responses on Rspack — recorded in those manifests as a host that cannot meet a
budget. It now uses `LocaleSwitchAdapter.isCatalogRequest`, which already existed for this question
and was already declared there.

`setTranslation` writes a translation in whichever of the two catalog shapes a project uses — values
are strings in a per-locale file and objects in a merged one — because a contract that assumed the
first would silently delete three languages on the second.

A `lazy-boundary` fixture covers colonies on Vite, which real-application coverage reached only on
Rspack. (An apparent blank frame it reported there turned out to be the probe conflating an
absent element with an empty one — withdrawn as ledger L-060.)

`hmr-warm` splits a capability that was carrying two guarantees: `hmr` says an edit reaches the
browser, `hmr-warm` says it is hot-replaced rather than answered by a reload. Measured, that line runs
through the framework rather than the host, which is the `hasClientReactivity` gate of L-030 and L-035
turned into a manifest claim instead of a paragraph.

Contracts that measured red are recorded as `pendingFor` carrying the measurement, not fixed — the
product changes are deliberately a separate pass. The largest is ledger L-064: editing a catalog
directly is unreliable on Rspack wherever the manager must _fetch_ the catalog rather than inline it
(10/10 runs failing on two projects, 6–7/10 on four, 0/10 on the two MPAs and on every Vite project).
That is L-056's defect, still live, exposed by the one mutation no existing contract performs.
