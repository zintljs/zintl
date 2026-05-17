import type { ResolvedConfig } from "vite";
import { ZintlCompiler, type LogLevel } from "@zintl/compiler";
import type { ZintlPluginContext } from "../context.js";
import { isAbsolute, relative } from "node:path";

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
      exclude: [...(userConfig.optimizeDeps?.exclude || []), "zintl", "zintl/internal"],
    };

    return configUpdate;
  };
}

export function configResolvedHook(ctx: ZintlPluginContext) {
  return function (config: ResolvedConfig) {
    const logLevel = ctx.options.logLevel || (config as any).logLevel || "info";
    ctx.compiler = new ZintlCompiler(
      {
        verifyIntegrity: config.command === "build",
        ...ctx.options,
        logLevel: logLevel as LogLevel,
      },
      config.root,
      config.command === "serve",
    );
    ctx.getMultiplex(config);
  };
}
