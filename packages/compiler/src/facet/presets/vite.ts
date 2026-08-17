import type { ZintlFacet } from "@zintljs/compiler";
import { selfAcceptHmrSnippet } from "../../utils/hmr.js";

/**
 * The Vite bundler contribution: virtual module resolution, the dynamic-import
 * template (with `@vite-ignore` in dev), and HMR acceptance code.
 *
 * **Always appended by the plugin, and not something to add yourself.** It is
 * listed here only so the facet set is legible — the plugin cannot function
 * without these hooks, so there is no way to opt out of it.
 */
export function viteFacet(): ZintlFacet {
  return {
    name: "vite",
    when: { bundler: "vite" },
    concern: "bundler",
    priority: 100,
    resolveVirtualPath: (id: string): string => id,
    /**
     * Rollup's null-byte convention, which Vite inherits.
     *
     * A substring test rather than a prefix one because boundary ids embed the
     * module id they were minted from. No real path contains a `\0`, so the
     * looser form costs nothing.
     */
    isVirtualId: (id: string): boolean => id.includes("\0"),
    /** Multiplex's per-locale HTML fan-out is implemented end to end on this host. */
    htmlFanOut: true,
    /**
     * `ViteUpdateApplier` (`packages/zintl/src/hmr/vite.ts`) applies hot updates
     * to this host's `ModuleGraph`, contributed from `configureServerHook`.
     */
    hotUpdate: true,

    /**
     * No `dependencyInvalidation`, and the omission is load-bearing rather than
     * an oversight. This host's hot-update hook is a *request*: it hands Zintl
     * an event and takes back the modules to invalidate, so `ViteUpdateApplier`
     * already names every one of them. Declaring the same catalog files as
     * watched dependencies on top of that is not belt-and-braces — Vite honours
     * them, so Zintl's own `flush()` writes come straight back in as source
     * changes, and every catalog-writing contract times out. Proposal 029 §3.
     */
    /**
     * Self-acceptance for Zintl's own generated modules.
     *
     * Always safe here, unlike {@link ZintlFacet.hmrInjectionCode} on a source
     * file: a catalog or manager is code Zintl wrote, so replacing it cannot
     * double-mount anything. The optional body runs with `newModule` in scope.
     */
    /**
     * `canRepaint` is deliberately ignored here, for the same reason
     * {@link hmrInjectionCode} ignores `hasClientReactivity` on this host.
     *
     * `ViteUpdateApplier` explicitly invalidates the entry's own modules when a
     * boundary updates, so the entry re-executes and repaints whether or not a
     * framework is subscribed to the store. A project with no client reactivity
     * is therefore still able to act on a new catalog here, which is exactly
     * what is not true on Rspack — and why this is a facet decision rather than
     * a shared one.
     */
    hmrSelfAcceptCode: (callbackBody?: string): string => {
      if (!callbackBody) {
        return `\nif (import.meta.hot) { import.meta.hot.accept(); }`;
      }
      return `\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n${callbackBody}\n  });\n}`;
    },
    dynamicImportTemplate: (path: string, isDev: boolean): string => {
      return `import(${isDev ? "/* @vite-ignore */ " : ""}${JSON.stringify(path)})`;
    },
    hmrInjectionCode: (
      fileId: string,
      hmrToken: number,
      hasAnchors?: boolean,
      entryReexecutionSafe = true,
    ): string => {
      let code = "";
      if (hasAnchors) {
        /**
         * An anchor file is an entry, and an entry mounts.
         *
         * Accepting means the bundler re-executes this module, so whether
         * accepting is safe depends entirely on whether re-running the mount is
         * harmless — which is a property of the framework, not of Zintl.
         * Assigning `innerHTML` replaces; Svelte's `mount()` appends a second
         * copy; React's `createRoot()` throws on a container it already owns.
         *
         * Both directions were measured, and each is wrong for the other half:
         *
         * - Always self-accepting double-mounts Svelte on an entry rewrite —
         *   proposal 024 §1.3, reproduced by `chaos-boundary`.
         * - Never self-accepting turns every entry edit into a full page reload,
         *   which times out `memory-leak` on `vanilla-spa-basic` (twenty
         *   sequential edits, twenty reloads).
         *
         * So the framework decides, via `RuntimeFacet.entryReexecutionSafe`.
         * Where re-execution is safe the entry self-accepts and hot updates stay
         * hot. Where it is not, the entry accepts and immediately hands the
         * update back, and the bundler bubbles it to a reload — which is what
         * would have happened had the file never claimed to accept.
         *
         * Accepting-then-invalidating rather than staying silent keeps the
         * decision explicit and greppable: "Zintl knows this file cannot
         * hot-replace itself", not "nobody thought about this file".
         *
         * `hasClientReactivity` is deliberately ignored here. It exists for
         * hosts where re-executing an entry is harmless but not *sufficient* —
         * Webpack re-runs against a module cache, so a non-reactive app can
         * re-seed itself from a stale manager with nothing to repaint the
         * result. Vite re-imports the whole chain, so re-execution always yields
         * the current catalog and no repaint is needed.
         */
        code += entryReexecutionSafe
          ? selfAcceptHmrSnippet(fileId)
          : `\n\nif (import.meta.hot) {\n  import.meta.hot.accept(() => {\n    // ${fileId} declares a trust anchor and this framework's mount is not\n    // replayable: re-running it would mount again instead of replacing.\n    import.meta.hot.invalidate();\n  });\n}`;
      }
      if (hmrToken > 0) {
        code += `\n\n// Zintl HMR Token: ${hmrToken}`;
      }
      return code;
    },
  };
}
