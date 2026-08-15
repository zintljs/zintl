---
"zintljs": patch
"@zintljs/compiler": patch
"@zintljs/testing": patch
---

Rebuild the Rsbuild examples as `create-rsbuild` starters, and extend the target to Svelte, routed SPAs and multi-page apps.

The two Rsbuild examples were never written to be examples — they grew out of proposal 026's falsification harness and were Vite's starter with the branding torn out, with names (`rsbuild-spa` = vanilla, `rsbuild-react` = no pattern) that did not say what they were. They are now `rsbuild-<framework>-<pattern>`, and each one reads as "I ran `pnpm create rsbuild`, then added localization": the page, the CSS and the mount point are the template's, and what is added is the four-locale switcher, `?lang=`, the catalogs, and the `index.html` Zintl needs to localize `<title>` and `<html dir>`.

Renamed: `rsbuild-spa` → `rsbuild-vanilla-basic`, `rsbuild-react` → `rsbuild-react-basic`.

New, each in the contract suite with capabilities earned one contract at a time:

- **`rsbuild-svelte-basic`** — Svelte 5 on Rspack. Previously "untested rather than unsupported"; it needed no Zintl change at all.
- **`rsbuild-vanilla-spa`** — a client router with a lazy `await import()` route, so catalog splitting on Rspack is demonstrated for a boundary the entry never imports statically rather than only for the trivial single-boundary case.
- **`rsbuild-vanilla-mpa`** — two `source.entry` keys, two HTML templates, and a shared component that anchors itself. The first project on either host to drive Zintl's multi-entry HTML path, which `hooks/html.ts` was written for and nothing had run.

The support statement moves with the evidence: Rsbuild now covers React, Svelte and vanilla, single-page and multi-page, in build and dev.

**Vue on Rsbuild is now documented as not supported**, and it is the reason there is no `rsbuild-vue-*` example. `vue-loader` compiles an SFC through per-block child requests that do not carry Zintl's transform, so a Vue app on Rspack extracts correctly, scaffolds correct catalogs, passes `verifyIntegrity`, emits correct catalog chunks — and then renders the source locale, because the code generation never reaches the `.vue` module. It builds green and it is wrong. Measured and written up as L-051; the `@rsbuild/plugin-vue` catalog entry is deliberately absent so the combination is harder to reach by accident. Use Vite for Vue.

Also here: the `hmr` capability is not claimed on the new projects, and the reason is measured rather than assumed — an edit to a string in a boundary the runtime has to _fetch_ loses the race with the catalog write when the page full-reloads (10 failures in 10 on Svelte, against React and vanilla passing 10 in 10 in the same batch). Documentation that described Rsbuild as an unsupported falsification target has been corrected in four places, and the `18 example apps → 72 contract tests` counts, already stale, are now 24 and 174.
