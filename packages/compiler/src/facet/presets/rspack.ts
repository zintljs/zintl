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
     * No `htmlFanOut`, and that omission is deliberate — the same shape of
     * decision as {@link hmrSelfAcceptCode} below. Multiplex's per-locale HTML
     * fan-out has no implementation on this host (026 §7, 027 §6 both exclude
     * MPA/HTML fan-out from scope). Declaring `false` here would read the same
     * as declaring nothing to the merge logic, so the honest move is to say
     * nothing: the fence this capability backs (`host.ts::ensureCompiler`,
     * ledger L-022) needs only "not true", not a value this facet has to own.
     */

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
     * `ViteUpdateApplier`'s counterpart on this host is
     * `RspackUpdateApplier` (`packages/zintl/src/hmr/rspack.ts`), contributed
     * from the plugin's `rspack(compiler)` block. ZDB §7a's two load-bearing
     * requirements are met here by facts about Rspack rather than by anything
     * Zintl supplies: `Watching.startTime` is the monotonic per-event sequence,
     * and `compiler.inputFileSystem` is the read scoped to that event. Proposal
     * 029 §2.
     */
    hotUpdate: true,

    /**
     * Rspack rebuilds what its own dependency graph says is stale, and asks
     * Zintl nothing — so a generated catalog that declares no inputs is never
     * stale, whatever the hot-update hook does. Declaring this is what gets
     * `getBoundaryInputs()` reported as `watchedFiles`, and it is why the
     * generated content and manager modules rebuild in the *same* compilation
     * as the source edit that dirtied them. Proposal 029 §3.
     */
    dependencyInvalidation: true,

    /**
     * An SFC block request here re-reads the whole file, so Zintl must transform
     * it rather than skip it.
     *
     * `vue-loader`'s pitcher intercepts `App.vue?vue&type=script` and rewrites
     * it into `-!<chain>!App.vue?vue&type=script` — a request whose resource is
     * the original file, with the chain re-applied over it
     * (`rspack-vue-loader/dist/pitcher.js`, `genRequest`). Measured: the loader
     * receives all 1836 bytes of the SFC, byte-identical to the parent request,
     * not the block.
     *
     * That inverts the rule Vite needs. There, the same id names a virtual
     * module holding one block, and transforming it would hand the extractor a
     * fragment. Here, skipping it means the only requests that become code are
     * never transformed — the parent is transformed and discarded — so the app
     * extracts correctly, scaffolds correct catalogs, passes `verifyIntegrity`,
     * and renders the source locale. Ledger L-051.
     *
     * The one cost is that a file with N block requests is transformed N+1
     * times. The transform is pure and the plans are cheap; a correct render is
     * worth more than the repeat.
     */
    sfcBlockRequestsCarryWholeFile: true,

    /**
     * The HMR token, plus acceptance where the framework allows it.
     *
     * The token is what makes the transformed source text actually differ, so
     * the host emits an update at all. The acceptance branch mirrors
     * `viteFacet`'s and rests on the same `RuntimeFacet.entryReexecutionSafe`
     * decision — an entry mounts, and re-running a mount is safe or not
     * depending on the framework, never on the bundler.
     *
     * Where it is *not* safe this emits nothing, rather than Vite's
     * accept-then-invalidate. Same outcome by a different route: with no
     * accepting module in the chain Webpack's update bubbles to the root and
     * becomes a full reload, which is precisely what `import.meta.hot.invalidate()`
     * arranges on Vite. There is no `invalidate()` to call here — the API has no
     * such method — so declining to accept *is* the spelling.
     */
    hmrInjectionCode: (
      _fileId: string,
      hmrToken: number,
      hasAnchors?: boolean,
      entryReexecutionSafe = true,
      hasClientReactivity = true,
    ): string => {
      let code = "";
      /**
       * Accepting requires re-execution to be both *harmless* and *sufficient*,
       * and on this host those come apart.
       *
       * Webpack re-executes an accepting module against the module cache, so a
       * re-run entry can read a manager that has not been replaced yet and seed
       * itself from a catalog predating the edit. A framework app survives that:
       * something is subscribed, so the catalog landing a moment later repaints
       * it. An app with no reactivity has only this re-execution, and renders
       * `""` for every key the incoming catalog was about to supply —
       * permanently, because nothing repaints (ledger L-030).
       *
       * So a non-reactive entry declines, and the update bubbles to a full
       * reload: slower than a hot update and *correct*, which is the trade Vite
       * already makes for frameworks whose mount is not replayable.
       */
      if (hasAnchors && entryReexecutionSafe && hasClientReactivity) {
        code += `\n\nif (import.meta.webpackHot) {\n  import.meta.webpackHot.accept();\n}`;
      }
      if (hmrToken > 0) {
        code += `\n\n// Zintl HMR Token: ${hmrToken}`;
      }
      return code;
    },

    /**
     * Self-acceptance for Zintl's own generated modules — and it **ignores its
     * callback body**, which is the load-bearing difference between the two
     * hosts' HMR APIs rather than an oversight.
     *
     * Vite's `import.meta.hot.accept(cb)` calls `cb(newModule)` *after* swapping
     * the module in, so a caller passes work to run against the new exports.
     * Webpack's — and therefore Rspack's — `accept(cb)` treats `cb` as an **error
     * handler** for failures while applying the update. It is never called on
     * success. Emitting Vite's shape here would compile, run, and silently
     * register the catalog re-registration as an error handler that never fires.
     *
     * Nothing is lost by dropping it, because Webpack achieves the same end
     * differently: a self-accepted module has its **whole body re-executed**. The
     * two callers that pass a body — the content module's `addCatalogs` and the
     * manager's `registerLoader` — both do that work in their module body
     * already, so re-execution runs it. The body is redundant here, not missing.
     *
     * `import.meta.webpackHot` rather than `module.hot`: the generated modules
     * are ESM, and Webpack forbids `module.hot` in a strict ESM module. It is the
     * spelling Rsbuild's own HMR client uses.
     */
    hmrSelfAcceptCode: (_callbackBody?: string, canRepaint = true): string => {
      /**
       * **Accepting is only correct when something can redraw.**
       *
       * This applier invalidates nothing by design — Rspack rebuilds whatever
       * its own dependency graph marks stale — so a generated catalog that
       * accepts its own update is the end of the line. On a project with no
       * client reactivity there is nothing subscribed to the store and nothing
       * re-runs the entry, so the update lands, `addCatalogs` applies it, and
       * the page keeps rendering the DOM it painted before the edit. Measured
       * exactly that way: the store held the new translation and the heading
       * held the old one (ledger L-064).
       *
       * Declining lets the update bubble to a full reload, which repaints from
       * the new catalog. Slower than a hot update and correct — the same trade
       * L-035 made for source files on this host, arrived at again one module
       * kind later, and for the same reason: a repaint this app cannot perform
       * must not be claimed as handled.
       */
      if (!canRepaint) return "";
      return `\nif (import.meta.webpackHot) { import.meta.webpackHot.accept(); }`;
    },
  };
}
