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
        code += `\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    console.debug("[Zintl] HMR update accepted for: ${fileId}");\n  });\n}`;
      }
      if (hmrToken > 0) {
        code += `\n\n// Zintl HMR Token: ${hmrToken}`;
      }
      return code;
    },
  };
}
