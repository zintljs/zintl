import type { ResolvedConfig } from "vite";
import { ZintlCompiler, type LogLevel } from "@zintl/compiler";
import type { ZintlPluginContext } from "../context.js";

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

      const expandedInput: Record<string, string> = { ...inputObj };
      for (const [key, val] of Object.entries(inputObj)) {
        if (val.endsWith(".html")) {
          for (const loc of locales) {
            const prefixKey = `${loc}/${key === "main" || key === "index" ? "index" : key}`;
            const prefixVal = `${loc}/${val}`;
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
  };
}
