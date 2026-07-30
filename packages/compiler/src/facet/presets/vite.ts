import type { ZintlFacet } from "@zintl/compiler";

interface ViteFacetOptions {
  // Option fields can be added in future if needed
}

/**
 * Vite bundler contribution.
 * Provides Vite-specific virtual module resolution, dynamic import template
 * (with @vite-ignore comment for dev mode), and HMR injection code.
 *
 * This facet is ALWAYS injected by the @zintl/zintl Vite plugin.
 * Users should not need to add it manually.
 */
export function viteFacet(_options: ViteFacetOptions = {}): ZintlFacet {
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
