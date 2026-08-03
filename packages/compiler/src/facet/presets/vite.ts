import type { ZintlFacet } from "@zintljs/compiler";

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
    concern: "bundler",
    priority: 100,
    resolveVirtualPath: (id: string): string => id,
    dynamicImportTemplate: (path: string, isDev: boolean): string => {
      return `import(${isDev ? "/* @vite-ignore */ " : ""}${JSON.stringify(path)})`;
    },
    hmrInjectionCode: (fileId: string, hmrToken: number, hasAnchors?: boolean): string => {
      let code = "";
      if (hasAnchors) {
        /**
         * Known defect, deliberately left in place: this accepts an update it
         * cannot actually apply.
         *
         * The callback only logs, which tells the bundler "handled" while
         * nothing is handled — the module re-executes and its side effects run
         * again. For an entry that means mounting a second time onto a container
         * that already has a mount: in Svelte the whole app renders twice, in
         * React it is `createRoot()` on an already-rooted container. That is
         * proposal 024 §1.3, and `chaos-boundary` reproduces it on `svelte-basic`.
         *
         * `import.meta.hot.invalidate()` here is the obvious fix and was
         * measured: it makes every entry-adjacent edit a full page reload,
         * regressing `hmr-hammer` on every project and taking the contract suite
         * from ~75 s to ~127 s. The real fix is a matching `dispose()` that tears
         * the previous mount down — which is framework knowledge, and so belongs
         * in a framework facet rather than in the bundler's injection hook.
         */
        code += `\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    console.debug("[Zintl] HMR update accepted for: ${fileId}");\n  });\n}`;
      }
      if (hmrToken > 0) {
        code += `\n\n// Zintl HMR Token: ${hmrToken}`;
      }
      return code;
    },
  };
}
