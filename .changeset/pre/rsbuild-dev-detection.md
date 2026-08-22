---
"zintljs": patch
---

Fixed development mode never being detected under Rsbuild, which stripped the dev-only runtime from every page the Rsbuild dev server served.

Dev detection on this family read `compiler.options.mode === "development"`. That is correct for webpack and for raw Rspack, where the user sets it — but **Rsbuild leaves `mode` at `"none"` for `dev`, `build` and `preview` alike**, because it drives optimisation from its own configuration rather than from webpack's mode presets. So `isDev` was `false` on the dev server, the runtime was generated with `__ZINTL_DEV__` folded to `false`, and the settle beacon and delivery ledger compiled away.

Nothing looked broken, which is why it survived: the page rendered, translated, and switched locale correctly. Only the diagnostics were gone — so every failure investigated on this host reported `settle beacon: ABSENT — no Zintl runtime on the page` about a page whose runtime was present and working, and the misdiagnosis was then recorded as a finding.

Dev-ness is a fact the **Rsbuild** layer owns and the Rspack layer cannot see, so it is now asked for where it lives: the plugin grows an `rsbuild` block — structurally the twin of its existing `vite` block — reading `api.context.action`, which Rsbuild documents as `"dev"` for both `rsbuild dev` and `rsbuild.startDevServer()`. `"preview"` is deliberately not dev, since it serves a production build. `Context.hostHints` carries the answer to compiler construction, which merges it over the view derived from the native build context.

That split is the general shape rather than a special case: a host can be a **stack**, and unplugin hands a plugin the _inner_ bundler's context under both. Hints complete a native view with facts the inner layer could not supply; they never override one it did.

No behaviour change on Vite, and none on Rsbuild production builds.
