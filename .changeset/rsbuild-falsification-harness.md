---
"@zintljs/testing": minor
"zintljs": minor
---

Added an experimental `zintljs/rsbuild` entry point and pointed the contract suite at it, as the second phase of proposal 026. Rsbuild is a falsification harness, not a supported target: the deliverable is the leak ledger, not Rsbuild support.

Zintl now builds a real SPA under Rsbuild, and all four project contracts (`build`, `graph`, `transform-dev`, `transform-prod`) pass against it. Notably, chunk-aligned catalogs survived the port with no Rspack-specific chunking code — the build emits one async chunk per non-source locale, each carrying only its own catalog, and ghost mode still omits the source locale entirely.

Three portability defects were found and fixed, all of which also make the Vite path more explicit:

- **The plugin now declares which ids its `load` hook handles** (`loadInclude`). On Rollup and Vite a `load` returning `undefined` is a free no-op; on Rspack, unplugin implements `load` as a module rule carrying `type: "javascript/auto"`, so an unfiltered hook claims every module and retypes it as JavaScript — which killed the build on the HTML template. The filter must be exact rather than generous: `.html` is claimed only under multiplex.

- **The plugin now declares which ids its `transform` hook handles** (`transformInclude`), excluding HTML. Zintl transforms HTML through `transformIndexHtml`, never through `transform` — true of its design all along, but never stated, because on Vite HTML is not a module in the graph and so never arrived there.

- **The host view is now derived from the host** rather than defaulting to `process.cwd()`. On a host with no config hook the default rooted the compiler at the monorepo root, discovering 217 boundaries across every example app and producing a manifest too large for `JSON.stringify`. `nativeHostView()` reads the root from unplugin's native build context.

Two further leaks are reproduced and deliberately left open, both tracing to one cause — Zintl identifies a generated asset module by the source file's real path plus a query, so that module inherits an extension and an absolute path that mean something to the host. On Rspack, which types modules by extension, a localized `.txt` asset is classified as an asset and the JavaScript Zintl generated for it is base64-encoded into a `data:` URI, so the catalog ships a URI where translated text belongs — with a green build and green contracts. The committed snapshot records that broken output on purpose, as the tripwire for whoever fixes it. Snapshot sanitization also grew a rule for identifiers Rspack names after the absolute resource path.

On the testing side, `BuildToolDriver` is now a real seam rather than a declared one: `LabPipeline` and `Lab` are typed on the interface instead of `ViteDriver`, a manifest can select its driver, and the bundler-free compile path is shared by both drivers unchanged. Adds `dirSource()` for checked-in project directories that should not join `examples/` and its build, lint and CI gates.

No behaviour change on Vite.
