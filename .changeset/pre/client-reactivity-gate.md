---
"@zintljs/compiler": minor
"@zintljs/extractor": patch
"zintljs": patch
---

Fixed client reactivity never being injected into plain React apps (ledger L-032), which also fixes the empty-render defect on Rspack (L-030) for framework apps.

**The gate asked the wrong question.** `useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)` was injected only into files where `observation.isClientComponent` held — and that is literally `code.includes('"use client"')`, a React Server Components directive. A plain React SPA never writes it, so no component in `react-basic`, `react-ssr` or a React app on any host subscribed to the store at all. Exactly one file in this repository carried the directive.

`RuntimeFacet.serverComponents` now decides it, declared `true` only by the Next.js runtime facet. Where a framework separates server components from client ones, the directive still gates injection; everywhere else every component is a client component. Both the import gate and the injection gate move together, so a file cannot import a hook it never calls.

**A second defect was hidden behind the first.** `registerComponentFunction` marked the outermost function containing _any_ JSX, with no name check — so a `bootstrap()` that merely calls `createRoot(el).render(<App />)` was treated as a component. Enabling the gate turned that into `Invalid hook call` and a blank page. It now requires a capitalised name, from the declaration or the binding an expression is assigned to, which is React's own rule; an unnamed function is not marked, because failing to subscribe degrades a repaint while a hook in a non-component breaks the app.

**Why this mattered beyond React.** On Vite the missing subscription had no visible consequence — its module ordering makes the first render correct, so nothing ever needed repainting. On Rspack a catalog can arrive after the render, and with no subscriber the page stayed permanently blank. `examples/rsbuild-react` now claims `hmr`.

Generated React output changes: components gain a `useSyncExternalStore` call and the corresponding imports.
