import type { Plugin } from "vite";
import { PLUGIN_NAME } from "./constants.js";
import { ZintlPluginContext } from "./context.js";
import type { ZintlPluginOptions } from "./types.js";

import { configHook, configResolvedHook } from "./hooks/config.js";
import { configureServerHook } from "./hooks/server.js";
import { resolveIdHook, loadHook } from "./hooks/resolve.js";
import { transformHook, transformIndexHtmlHook } from "./hooks/transform.js";
import { handleHotUpdateHook } from "./hooks/hmr.js";
import { buildStartHook, buildEndHook } from "./hooks/build.js";

export type { ZintlPluginOptions, ZintlPluginFacetInput } from "./types.js";

// Re-export default facet factories and constants from @zintl/compiler
export {
  vanillaFacet,
  reactExtractionFacet,
  reactCodegenFacet,
  reactFacet,
  vueExtractionFacet,
  vueCodegenFacet,
  vueFacet,
  svelteExtractionFacet,
  svelteCodegenFacet,
  svelteFacet,
  htmlExtractionFacet,
  htmlProjectionFacet,
  htmlFacet,
  nextjsSsrFacet,
  nextjsExtractionFacet,
  nextjsRuntimeFacet,
  nextjsFacet,
  ssrWrappingFacet,
  ssrRuntimeFacet,
  ssrFacet,
  clientSpaFacet,
  viteFacet,
  assetsFacet,
} from "@zintl/compiler";

/**
 * Zintl Vite Plugin
 * Handles message extraction and virtual catalog injection.
 */
export function zintl(options: ZintlPluginOptions = {}): any {
  const ctx = new ZintlPluginContext(options);

  const prePlugin: Plugin = {
    name: "zintl-pre",
    enforce: "pre",
    transformIndexHtml: {
      order: "pre",
      handler(html: string, viteCtx: any) {
        const filename = viteCtx.filename || viteCtx.path || "";
        const normalizedPath = filename.replace(/\\/g, "/");
        const parts = normalizedPath.split("?")[0].split("/");
        const locales = ctx.options.locales || ["en"];
        const pathParts = (viteCtx.path || "").split("/").filter(Boolean);
        const isFanned =
          parts.some((p: string) => locales.includes(p)) ||
          pathParts.some((p: string) => locales.includes(p)) ||
          normalizedPath.includes("virtual:zintl-multiplex-html");

        const isMultiplex = ctx.getMultiplex();
        // console.log("[Zintl Debug] zintl-pre transformIndexHtml:", {
        //   filename,
        //   normalizedPath,
        //   isFanned,
        //   isMultiplex,
        // });

        if (isMultiplex && !isFanned) {
          // console.log("[Zintl Debug] zintl-pre returning redirect for:", filename);
          const localesStr = JSON.stringify(locales);
          const defaultLocale = ctx.options.sourceLocale || "en";
          return `<!doctype html>
<html lang="${defaultLocale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Redirecting...</title>
    <script id="zintl-multiplex-redirect">
      (function() {
        try {
          const lang = (navigator.language || '${defaultLocale}').split('-')[0];
          const supported = ${localesStr};
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts.length > 0 && supported.includes(parts[0])) return;
          const target = supported.includes(lang) ? lang : '${defaultLocale}';
          const path = window.location.pathname.replace(/^/+/, '');
          window.location.replace('/' + target + '/' + path + window.location.search + window.location.hash);
        } catch (e) {
          const supported = ${localesStr};
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts.length > 0 && supported.includes(parts[0])) return;
          const path = window.location.pathname.replace(/^/+/, '');
          window.location.replace('/${defaultLocale}/' + path);
        }
      })();
    </script>
  </head>
  <body>
  </body>
</html>`;
        }
        return html;
      },
    },
  };

  const mainPlugin: Plugin = {
    name: PLUGIN_NAME,
    enforce: "pre",

    config: configHook(ctx),
    configResolved: configResolvedHook(ctx),
    configureServer: configureServerHook(ctx),
    buildStart: buildStartHook(ctx),
    resolveId: resolveIdHook(ctx),
    load: loadHook(ctx),
    transform: transformHook(ctx),
    transformIndexHtml: transformIndexHtmlHook(ctx),
    handleHotUpdate: handleHotUpdateHook(ctx),
    hotUpdate: handleHotUpdateHook(ctx),
    buildEnd: buildEndHook(ctx),
  };

  Object.defineProperty(mainPlugin, "__compiler", {
    get() {
      return ctx.compiler;
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(mainPlugin, "__options", {
    get() {
      return ctx.options;
    },
    configurable: true,
    enumerable: true,
  });

  const result = [prePlugin, mainPlugin];

  const propertiesToForward = [
    "name",
    "enforce",
    "config",
    "configResolved",
    "configureServer",
    "buildStart",
    "resolveId",
    "load",
    "transform",
    "transformIndexHtml",
    "handleHotUpdate",
    "hotUpdate",
    "buildEnd",
  ];

  for (const prop of propertiesToForward) {
    Object.defineProperty(result, prop, {
      get() {
        return (mainPlugin as any)[prop];
      },
      configurable: true,
      enumerable: true,
    });
  }

  Object.defineProperty(result, "__compiler", {
    get() {
      return ctx.compiler;
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(result, "__options", {
    get() {
      return ctx.options;
    },
    configurable: true,
    enumerable: true,
  });

  return result as any;
}
