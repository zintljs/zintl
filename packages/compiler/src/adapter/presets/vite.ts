import { isAbsolute, relative } from "node:path";
import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Vite bundler adapter.
 * Provides Vite-specific virtual module resolution, dynamic import template
 * (with @vite-ignore comment for dev mode), and HMR injection code.
 *
 * This adapter is ALWAYS injected by the @zintl/zintl Vite plugin.
 * Users should not need to add it manually.
 */
const viteBundlerAdapter: ZintlAdapter = {
  name: "vite",
  bundler: {
    resolveVirtualPath: (id: string): string => id,
    dynamicImportTemplate: (path: string, isDev: boolean): string => {
      return `import(${isDev ? "/* @vite-ignore */ " : ""}${JSON.stringify(path)})`;
    },
    hmrInjectionCode: (fileId: string, hmrToken: number): string => {
      // HMR injection is handled at the plugin level in @zintl/zintl transform hook.
      // This stub enables the capability flag; the actual injection logic remains
      // in the Vite plugin's transform hook which has access to the Vite context.
      let code = "";
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
  },
};

registerPreset("vite", () => [viteBundlerAdapter]);

export { viteBundlerAdapter };
