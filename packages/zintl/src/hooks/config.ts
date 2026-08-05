import type { ResolvedConfig } from "vite";
import type { LogLevel } from "@zintljs/compiler";
import { ensureCompiler, type BundlerHostView } from "../host.js";
import type Context from "../context.js";
import { isAbsolute, relative } from "node:path";

export function configHook(ctx: Context) {
  return function (userConfig: any) {
    const multiplex = ctx.getMultiplex(userConfig);
    const locales = ctx.options.locales;
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

/**
 * Whether this Vite project is doing SSR, asked separately for build and dev
 * because the config only names it in one of them.
 *
 * This used to be `Boolean(config.build?.ssr) || config.ssr !== undefined`, and
 * the second clause is **always true** on current Vite — `ResolvedConfig` always
 * carries a populated `ssr` object. So every project resolved as SSR, and a
 * vanilla SPA with no server anything was handed `ssr-wrapping` and
 * `ssr-runtime` (ledger L-011). Output stayed correct only because
 * `getRuntimeCode` gates the server store on `isSsr` a second time; the
 * capability flags themselves were wrong. The clause was presumably once a real
 * discriminator and quietly decayed into a constant.
 *
 * **Build** — `build.ssr` is authoritative and exact. Note this also means the
 * *client* half of an SSR app no longer resolves the SSR facets, which is the
 * point: nothing about wrapping a server entry or scoping a request belongs in a
 * browser bundle.
 *
 * **Dev** — nothing in the config names SSR, and `build.ssr` is unset, so
 * dropping the old clause outright took every SSR contract down with it (all ten
 * cases, measured). What does distinguish an SSR dev server is its *shape*: Vite
 * embedded in the user's own HTTP server, which is `middlewareMode` plus
 * `appType: "custom"`. Both are set by every SSR example and by the streaming
 * fixture, neither is set by any SPA or MPA, and `configureServerHook` already
 * treats `appType === "custom"` as meaningful — so this reuses a signal the
 * plugin trusts rather than inventing one.
 *
 * It is still a heuristic, and worth saying so plainly: a project that embeds
 * Vite in its own server without doing SSR would resolve the SSR facets. That is
 * a far smaller wrong set than "every project", and unlike the old clause it can
 * actually answer "no".
 */
function isViteSsr(config: ResolvedConfig): boolean {
  if (config.command === "serve") {
    return Boolean(config.server?.middlewareMode) || config.appType === "custom";
  }
  return Boolean(config.build?.ssr);
}

/**
 * Translate a Vite `ResolvedConfig` into the host view compiler construction
 * needs.
 *
 * This function is the whole of what was Vite-specific about building a
 * compiler. Everything downstream of it is shared with every other host.
 */
function viteHostView(config: ResolvedConfig): BundlerHostView {
  return {
    root: config.root,
    bundler: "vite",
    isDev: config.command === "serve",
    isSsr: isViteSsr(config),
    pluginNames: Array.isArray(config.plugins)
      ? config.plugins.map((p) => p?.name).filter(Boolean)
      : [],
    logLevel: (config as any).logLevel as LogLevel | undefined,
  };
}

export function configResolvedHook(ctx: Context) {
  return function (config: ResolvedConfig) {
    ensureCompiler(ctx, viteHostView(config));
    ctx.getMultiplex(config);
  };
}
