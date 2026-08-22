---
"@zintljs/testing": minor
"zintljs": patch
---

Made the lab's dev server host-agnostic, so browser contracts can run against a build tool other than Vite.

`BuildToolDriver` already covered the build side; the serving side was hardwired to Vite, which is why seventeen of twenty-one contracts could not see a second host. `DevServerDriver` is its counterpart — `LabDevServerHandle` describes a running server in the lab's terms, with `ViteDevServerDriver` holding the existing logic and a new `RsbuildDevServerDriver` alongside it. A manifest selects its driver the same way it already did for builds.

Two collaborators stopped knowing what Vite is. `LabWebSocket` takes an intercept function rather than a `ViteDevServer`, with the `ws.send` patch moved into the Vite driver where host knowledge belongs; a host that cannot expose a hot-update channel simply omits it, rather than reporting "no packets" when it means "cannot see packets". `LabCompiler` identifies its compiler by project root rather than by a server object.

**Also fixes: every Rspack build looked like production, including the dev server.** `nativeHostView` filled in the bundler and root from the host's native context but left `isDev` at its default of `false`, so a page served in development was compiled as a production build — `__ZINTL_DEV__` folded away, no settle beacon, no dev logging. It went unnoticed because the app was otherwise correct. Dev is now read from `compiler.options.mode`, this family's equivalent of Vite's `command === "serve"`.
