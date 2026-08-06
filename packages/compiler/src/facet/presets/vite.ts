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
     * Self-acceptance for Zintl's own generated modules.
     *
     * Always safe here, unlike {@link ZintlFacet.hmrInjectionCode} on a source
     * file: a catalog or manager is code Zintl wrote, so replacing it cannot
     * double-mount anything. The optional body runs with `newModule` in scope.
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
