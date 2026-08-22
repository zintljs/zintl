---
"@zintljs/compiler": minor
"zintljs": patch
"@zintljs/testing": patch
---

Fenced ledger L-022: combining `multiplex: true` with a bundler that has no HTML fan-out support now fails fast with a clear `[Zintl] Multiplex is not supported...` error, instead of an opaque `html-rspack-plugin` loader-chain crash on Rspack/Rsbuild.

Under multiplex (per-locale HTML fan-out), `loadIncludeHook` claims `.html` on the assumption that `loadHook` will serve it — true on Vite, where the fan-out is implemented, and fatal on Rspack: unplugin retypes the claimed template as `javascript/auto`, and the build dies inside `html-rspack-plugin`'s child compilation parsing `<!doctype html>` as JS.

`BundlerFacet` gains `htmlFanOut?: boolean` — declared `true` on `viteFacet`, deliberately left undeclared on `rspackFacet` — following the same "ask the facet, don't test the bundler string" pattern ledger L-004 established for `isVirtualId`. `host.ts::ensureCompiler` checks the resolved capability against `ctx.getMultiplex()` before constructing the compiler, so the fence fires once, before any module resolution, on every host.

The real HTML fan-out for Rspack remains undesigned and out of scope (026 §7, 027 §6) — this only replaces a crash with a loud, actionable error. Verified against a real `zintljs/rsbuild` build via a new fixture and contract (`tests/fixtures/multiplex-rsbuild-fence.ts`, `tests/contracts/multiplex-fence.contract.spec.ts`, capability `"multiplex-fenced"`).
