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

    let detectedFrameworks: string[] = [];
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
      detectedFrameworks = Array.from(frameworks);
    } else {
      detectedFrameworks = ["react"];
    }

    const adapters: any[] = [];

    // Always inject the "vite" bundler adapter
    adapters.push("vite");

    // Add user-provided adapters
    if (ctx.options.adapters) {
      adapters.push(...ctx.options.adapters);
    } else {
      // If user did not provide custom adapters, expand detected frameworks
      for (const f of detectedFrameworks) {
        adapters.push(f);
      }

      // If it has nextjs or general SSR, we add the SSR adapter
      const hasSsr =
        detectedFrameworks.includes("nextjs") ||
        config.build?.ssr ||
        (config as any).ssr !== undefined;

      if (hasSsr) {
        if (!detectedFrameworks.includes("nextjs")) {
          adapters.push("ssr");
        }
      }

      // Add client-spa for SPA/client-side locale sync
      if (!detectedFrameworks.includes("nextjs")) {
        adapters.push("client-spa");
      }

      // Add vanilla and html presets as default fallbacks
      adapters.push("vanilla", "html");
    }

    // Resolve extensions
    const defaultExtensions = [".ts", ".tsx", ".js", ".jsx", ".html"];
    const extraExtensions: string[] = [];
    if (adapters.includes("vue") || detectedFrameworks.includes("vue")) {
      extraExtensions.push(".vue");
    }
    if (adapters.includes("svelte") || detectedFrameworks.includes("svelte")) {
      extraExtensions.push(".svelte");
    }
    const extensions = ctx.options.extensions || [...defaultExtensions, ...extraExtensions];

    const targets =
      ctx.options.targets || Array.from(new Set([...detectedFrameworks, "vanilla", "html"]));

    ctx.compiler = new ZintlCompiler(
      {
        verifyIntegrity: config.command === "build",
        ...ctx.options,
        targets: targets as any[],
        adapters,
        extensions,
        logLevel: logLevel as LogLevel,
      },
      config.root,
      config.command === "serve",
    );

    ctx.getMultiplex(config);
  };
}
