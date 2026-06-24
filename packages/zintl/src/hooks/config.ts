import type { ResolvedConfig } from "vite";
import { ZintlCompiler, type LogLevel } from "@zintl/compiler";
import type { ZintlPluginContext } from "../context.js";
import { isAbsolute, relative, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function configHook(ctx: ZintlPluginContext) {
  return function (userConfig: any) {
    const multiplex = ctx.getMultiplex(userConfig);
    const locales = ctx.options.locales || ["en"];
    const configUpdate: any = {};

    if (ctx.options.debug) {
      configUpdate.define = {
        "process.env.ZINTL_DEBUG": JSON.stringify(
          ctx.options.debug === true ? "true" : ctx.options.debug,
        ),
      };
    }

    if (multiplex) {
      const userBuild = userConfig.build || {};
      const userRollupOptions = userBuild.rollupOptions || {};
      const userInput = userRollupOptions.input || "index.html";

      const inputObj: Record<string, string> = {};
      if (typeof userInput === "string") {
        inputObj.index = userInput;
      } else if (Array.isArray(userInput)) {
        userInput.forEach((inp, idx) => {
          const name = inp.replace(/\.html$/, "").replace(/[^a-zA-Z0-9]/g, "_");
          inputObj[name || `input_${idx}`] = inp;
        });
      } else if (typeof userInput === "object" && userInput !== null) {
        Object.assign(inputObj, userInput);
      }

      // Clean fanned inputs to avoid double-fanning
      for (const [key, val] of Object.entries(inputObj)) {
        for (const loc of locales) {
          if (val.startsWith(`${loc}/`) || val.startsWith(`./${loc}/`)) {
            delete inputObj[key];
          }
        }
      }

      if (Object.keys(inputObj).length === 0) {
        inputObj.index = "index.html";
      }

      const root = userConfig.root || process.cwd();
      const expandedInput: Record<string, string> = { ...inputObj };
      for (const [key, val] of Object.entries(inputObj)) {
        if (val.endsWith(".html")) {
          const relativeVal = isAbsolute(val) ? relative(root, val) : val;
          for (const loc of locales) {
            const prefixKey = `${loc}/${key === "main" || key === "index" ? "index" : key}`;
            const prefixVal = `${loc}/${relativeVal}`;
            expandedInput[prefixKey] = prefixVal;
          }
        }
      }

      configUpdate.build = {
        rollupOptions: {
          input: expandedInput,
        },
      };
    }

    configUpdate.optimizeDeps = {
      exclude: [
        ...(userConfig.optimizeDeps?.exclude || []),
        "zintl",
        "zintl/internal",
        "virtual:zintl/runtime",
        "virtual:zintl/runtime/internal",
      ],
    };

    return configUpdate;
  };
}

export function configResolvedHook(ctx: ZintlPluginContext) {
  return function (config: ResolvedConfig) {
    const logLevel = ctx.options.logLevel || (config as any).logLevel || "info";

    let targets = ctx.options.targets || ["auto"];
    if (targets.includes("auto")) {
      const detected: string[] = [];
      const frameworks = new Set<string>();

      if (config.plugins && Array.isArray(config.plugins)) {
        for (const plugin of config.plugins) {
          if (plugin && plugin.name) {
            const name = plugin.name.toLowerCase();
            if (name.includes("vue")) frameworks.add("vue");
            if (name.includes("react")) frameworks.add("react");
            if (name.includes("svelte")) frameworks.add("svelte");
            if (name.includes("next") || name.includes("vinext")) frameworks.add("nextjs");
          }
        }
      }

      try {
        const pkgPath = join(config.root, "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
          };
          if (allDeps["vue"]) frameworks.add("vue");
          if (allDeps["react"]) frameworks.add("react");
          if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) frameworks.add("svelte");
          if (allDeps["next"] || allDeps["vinext"]) frameworks.add("nextjs");
        }
      } catch {}

      if (frameworks.size > 0) {
        for (const f of frameworks) {
          detected.push(f);
        }
        detected.push("vanilla", "html");
      } else {
        detected.push("vanilla", "react", "html");
      }

      targets = (targets.filter((t) => t !== "auto") as string[]).concat(detected) as any[];
      targets = Array.from(new Set(targets));
    }

    const adapters: any[] = [];
    if (targets.includes("vue")) {
      adapters.push({
        name: "vue",
        match: (filePath: string) => filePath.endsWith(".vue"),
        sfc: true,
        wrapSfcScript: (code: string) => `<script setup lang="ts">\n${code}</script>\n`,
        wrapHtmlText: (replacement: string, hasTags: boolean, hasVars: boolean) => {
          if (hasVars) {
            if (hasTags) {
              return `<span v-html="${replacement.replace(/"/g, "&quot;")}"></span>`;
            } else {
              return `{{ ${replacement} }}`;
            }
          }
          return replacement;
        },
        wrapHtmlAttribute: (attrName: string, replacement: string, hasVars: boolean) => {
          if (hasVars) {
            return `:${attrName}="${replacement}"`;
          }
          return replacement;
        },
      });
    }

    if (targets.includes("svelte")) {
      adapters.push({
        name: "svelte",
        match: (filePath: string) => filePath.endsWith(".svelte"),
        sfc: true,
        wrapSfcScript: (code: string) => `<script>\n${code}</script>\n`,
        wrapHtmlText: (replacement: string, hasTags: boolean, hasVars: boolean) => {
          if (hasVars) {
            if (hasTags) {
              return `{@html ${replacement} }`;
            } else {
              return `{ ${replacement} }`;
            }
          }
          return replacement;
        },
        wrapHtmlAttribute: (attrName: string, replacement: string, hasVars: boolean) => {
          if (hasVars) {
            return `${attrName}={${replacement}}`;
          }
          return replacement;
        },
      });
    }

    if (targets.includes("react") || targets.includes("nextjs")) {
      adapters.push({
        name: "react",
        match: (filePath: string) =>
          filePath.endsWith(".tsx") ||
          filePath.endsWith(".jsx") ||
          (!adapters.some((a) => a.sfc && a.match(filePath)) && !filePath.endsWith(".html")),
        jsx: true,
      });
    }

    const defaultExtensions = [".ts", ".tsx", ".js", ".jsx", ".html"];
    const extraExtensions: string[] = [];
    if (targets.includes("vue")) {
      extraExtensions.push(".vue");
    }
    if (targets.includes("svelte")) {
      extraExtensions.push(".svelte");
    }
    const extensions = ctx.options.extensions || [...defaultExtensions, ...extraExtensions];

    let ssrEntryTargets = ctx.options.ssrEntryTargets;
    let ssrWrapDefault = ctx.options.ssrWrapDefault;
    let ssrWrapExports = ctx.options.ssrWrapExports;

    if (targets.includes("nextjs")) {
      if (ssrEntryTargets === undefined) {
        ssrEntryTargets = [
          "virtual:vinext-rsc-entry",
          "virtual:vinext-server-entry",
          "virtual:vinext-app-ssr-entry",
          "app-ssr-entry",
        ];
      }
      if (ssrWrapDefault === undefined) {
        ssrWrapDefault = "fetch";
      }
      if (ssrWrapExports === undefined) {
        ssrWrapExports = ["renderPage", "handleApiRoute", "runMiddleware", "handleSsr"];
      }
    }

    ctx.compiler = new ZintlCompiler(
      {
        verifyIntegrity: config.command === "build",
        ...ctx.options,
        ssrEntryTargets,
        ssrWrapDefault,
        ssrWrapExports,
        targets,
        adapters,
        extensions,
        logLevel: logLevel as LogLevel,
        resolveVirtualPath: (id: string) => id,
        dynamicImportTemplate: (path: string, isDev: boolean) => {
          return `import(${isDev ? "/* @vite-ignore */ " : ""}${JSON.stringify(path)})`;
        },
        hmrInjectionCode: (fileId: string, hmrToken: number) => {
          const anchorCount =
            ctx.compiler?.messages?.metadataGraph[fileId]?.anchorSites?.length || 0;
          let code = "";
          if (anchorCount > 0) {
            code += `\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    console.debug("[Zintl] HMR update accepted for: ${fileId}");\n  });\n}`;
          }
          if (hmrToken > 0) {
            code += `\n\n// Zintl HMR Token: ${hmrToken}`;
          }
          return code;
        },
        ssrWrapCode: (params) => {
          if (ctx.options.ssrWrapCode) {
            const userWrapped = ctx.options.ssrWrapCode(params);
            if (userWrapped !== undefined) return userWrapped;
          }
          const { code, fileId, isEntry, locales, sourceLocale } = params;
          if (
            isEntry ||
            fileId.endsWith("entry-server") ||
            fileId.endsWith("entry-server.ts") ||
            fileId.endsWith("entry-server.js")
          ) {
            if (!code.includes("_zintl_raw_render") && !code.includes("_zintl_runInRequestScope")) {
              const localesStr = JSON.stringify(locales);
              const defaultLocaleStr = JSON.stringify(sourceLocale || "en");

              const funcRegex = /export\s+(async\s+)?function\s+render\b/;
              if (funcRegex.test(code)) {
                let res = code.replace(
                  /export\s+(async\s+)?function\s+render\b/,
                  "async function _zintl_raw_render",
                );
                res += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "virtual:zintl/runtime/internal";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
                return res;
              } else {
                const exportBlockRegex = /export\s*\{([^}]+)\}/g;
                let match;
                let found = false;
                let res = code;
                while ((match = exportBlockRegex.exec(code)) !== null) {
                  const content = match[1];
                  if (/\brender\b/.test(content)) {
                    const parts = content.split(",").map((p) => p.trim());
                    const index = parts.findIndex(
                      (p) =>
                        p === "render" || p.startsWith("render as ") || p.endsWith(" as render"),
                    );
                    if (index !== -1) {
                      const part = parts[index];
                      if (part === "render") {
                        parts[index] = "render as _zintl_raw_render";
                        found = true;
                      } else if (part.endsWith(" as render")) {
                        const localName = part
                          .substring(0, part.length - " as render".length)
                          .trim();
                        parts[index] = `${localName} as _zintl_raw_render`;
                        found = true;
                      }
                      if (found) {
                        const newBlock = `export { ${parts.join(", ")} }`;
                        res = res.replace(match[0], newBlock);
                        res += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "virtual:zintl/runtime/internal";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
                        break;
                      }
                    }
                  }
                }
                if (found) return res;
              }
            }
          }
          return undefined;
        },
      },
      config.root,
      config.command === "serve",
    );
    ctx.getMultiplex(config);
  };
}
