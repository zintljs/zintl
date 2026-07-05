import { isAbsolute, relative } from "node:path";
import type { ZintlFacet } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Vite bundler contribution.
 * Provides Vite-specific virtual module resolution, dynamic import template
 * (with @vite-ignore comment for dev mode), and HMR injection code.
 *
 * This facet is ALWAYS injected by the @zintl/zintl Vite plugin.
 * Users should not need to add it manually.
 */
const viteBundlerFacet: ZintlFacet = {
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
  fanBuildInputs: (
    inputs: Record<string, string>,
    locales: string[],
    root: string,
  ): Record<string, string> => {
    const expandedInput: Record<string, string> = { ...inputs };

    for (const [key, val] of Object.entries(inputs)) {
      if (val.endsWith(".html")) {
        const relativeVal = isAbsolute(val) ? relative(root, val) : val;
        for (const loc of locales) {
          const prefixKey = `${loc}/${key === "main" || key === "index" ? "index" : key}`;
          const prefixVal = `${loc}/${relativeVal}`;
          expandedInput[prefixKey] = prefixVal;
        }
      }
    }

    return expandedInput;
  },
};

registerPreset("vite", () => [viteBundlerFacet]);

export { viteBundlerFacet };
