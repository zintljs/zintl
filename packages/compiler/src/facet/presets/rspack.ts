import type { ZintlFacet } from "@zintljs/compiler";

/**
 * The Rspack bundler contribution.
 *
 * **Experimental, and build-time only.** It exists because proposal 026 put a
 * second host in front of the plugin, and the absence of a bundler facet there
 * was not neutral: with none active, core falls back to `selfAcceptHmrSnippet`
 * and injects `import.meta.hot` — Vite's API — into Rspack output. Five
 * committed dev-transform snapshots contained it before this facet existed.
 *
 * So the point of this facet is as much what it *stops* as what it adds.
 */
export function rspackFacet(): ZintlFacet {
  return {
    name: "rspack",
    concern: "bundler",
    priority: 100,
    /**
     * Unplugin's Rspack build context reports `framework: "rspack"` even when
     * the host is Rsbuild — verified against `@rsbuild/core@2.1.10`, whose
     * plugin adapter delegates to the Rspack one. So Rsbuild needs no separate
     * name here, and if that ever changes the composition-fidelity contract
     * fails rather than silently resolving no bundler facet at all.
     */
    when: { bundler: "rspack" },

    /**
     * Identity, like Vite's.
     *
     * The `\0` prefix is added by the plugin rather than here, and it survives
     * the round trip on this host: `resolveId` returns `\0virtual:zintl/…` and
     * `load` receives that same string back. What does *not* survive is the
     * `transform` boundary, where unplugin materialises the module as a real
     * path under `node_modules/.virtual/` — see ledger L-004.
     */
    resolveVirtualPath: (id: string): string => id,

    /**
     * Two spellings, because a virtual module has two identities on this host.
     *
     * `resolveId` and `load` see the `\0` form Zintl constructed. `transform`
     * and the module graph see the materialised file, which unplugin writes
     * under `<context>/node_modules/.virtual/` (optionally with a pid segment —
     * `unplugin@3.3.0`, `VIRTUAL_MODULE_PREFIX`). Recognising only the first
     * misses every module past the `transform` boundary.
     *
     * Before this hook existed, the second case survived on a coincidence: core
     * skipped those modules because an adjacent `id.includes("node_modules")`
     * test happened to be true. Correct behaviour resting on another project's
     * choice of directory (ledger L-004).
     */
    isVirtualId: (id: string): boolean =>
      id.includes("\0") || id.replace(/\\/g, "/").includes("node_modules/.virtual"),

    /**
     * A plain dynamic import, deliberately unannotated.
     *
     * No `/* @vite-ignore *\/`, which is what the unconditionally-appended Vite
     * facet used to emit here (ledger L-012). And no `webpackIgnore` either:
     * these ids are ones Zintl's own `resolveId` handles, so telling the host to
     * skip them would break catalog loading outright. Rspack splits them into
     * per-locale async chunks exactly as intended.
     */
    dynamicImportTemplate: (path: string): string => `import(${JSON.stringify(path)})`,

    /**
     * The HMR token, and **no acceptance call**.
     *
     * This is a declaration of a known gap rather than an omission. Rspack uses
     * `module.hot`, not `import.meta.hot`, so the inherited Vite snippet is
     * simply wrong here — but emitting the `module.hot` equivalent would be
     * worse: ZDB §7a makes dev support conditional on two load-bearing
     * properties, a monotonic non-repeating per-event sequence and a `read()`
     * scoped to that event, and neither has been shown to exist on this host.
     * Shipping hot updates without them would ship back the ordering defect the
     * delivery-bus specification exists to remove.
     *
     * Returning a function at all still matters: it takes core off its
     * `import.meta.hot` fallback path. Wrong code is worse than no code.
     */
    hmrInjectionCode: (_fileId: string, hmrToken: number): string => {
      return hmrToken > 0 ? `\n\n// Zintl HMR Token: ${hmrToken}` : "";
    },

    /**
     * Nothing, for the same reason {@link hmrInjectionCode} emits no acceptance
     * call: Tier 2 is not implemented on this host.
     *
     * Supplying the hook at all is still what matters. Before it existed the
     * compiler hardcoded `import.meta.hot` for generated catalogs and managers
     * and consulted no facet, so this host received Vite's API regardless.
     * Declaring "no hot-update story yet" is the honest answer, and it is the
     * one that stops the wrong one being emitted.
     */
    hmrSelfAcceptCode: (): string => "",
  };
}
