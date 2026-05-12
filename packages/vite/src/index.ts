import type { Plugin } from "vite";
import type { ZintlOptions } from "@zintl/compiler";
import { PLUGIN_NAME } from "./constants.js";
import { ZintlPluginContext } from "./context.js";

import { configHook, configResolvedHook } from "./hooks/config.js";
import { configureServerHook } from "./hooks/server.js";
import { resolveIdHook, loadHook } from "./hooks/resolve.js";
import { transformHook, transformIndexHtmlHook } from "./hooks/transform.js";
import { handleHotUpdateHook } from "./hooks/hmr.js";
import { buildStartHook, buildEndHook } from "./hooks/build.js";

/**
 * Zintl Vite Plugin
 * Handles message extraction and virtual catalog injection.
 */
export function zintl(
  options: ZintlOptions = {},
): Plugin & { __compiler: any; __options: ZintlOptions } {
  const ctx = new ZintlPluginContext(options);

  return {
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
    buildEnd: buildEndHook(ctx),

    get __compiler() {
      return ctx.compiler;
    },
    get __options() {
      return ctx.options;
    },
  } as any;
}
