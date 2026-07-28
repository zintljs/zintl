import { createUnplugin, type UnpluginFactory } from "unplugin";
import { PLUGIN_NAME } from "./constants.js";
import { ZintlPluginContext } from "./context.js";
import type { ZintlPluginOptions } from "./index.js";

import { configHook, configResolvedHook } from "./hooks/config.js";
import { configureServerHook } from "./hooks/server.js";
import { resolveIdHook, loadHook } from "./hooks/resolve.js";
import {
  transformHook,
  transformIndexHtmlHook,
  preTransformIndexHtmlHook,
} from "./hooks/transform.js";
import { handleHotUpdateHook } from "./hooks/hmr.js";
import { buildStartHook, buildEndHook } from "./hooks/build.js";

export const contextMap = new WeakMap<ZintlPluginOptions, ZintlPluginContext>();

/**
 * Zintl Unplugin Factory
 */
const zintlFactory: UnpluginFactory<ZintlPluginOptions, true> = (options) => {
  const ctx = new ZintlPluginContext(options);
  contextMap.set(options, ctx);

  if (typeof globalThis !== "undefined") {
    const activeContexts = globalThis as unknown as {
      __zintl_active_contexts?: ZintlPluginContext[];
    };
    activeContexts.__zintl_active_contexts = activeContexts.__zintl_active_contexts || [];
    activeContexts.__zintl_active_contexts.push(ctx);
  }

  return [
    {
      name: "zintl-pre",
      vite: {
        enforce: "pre",
        transformIndexHtml: preTransformIndexHtmlHook(ctx),
      },
    },
    {
      name: PLUGIN_NAME,
      enforce: "pre",

      buildStart() {
        return buildStartHook(ctx).call(this);
      },

      resolveId(id, importer, options) {
        return resolveIdHook(ctx).call(this, id, importer, options as unknown as { ssr?: boolean });
      },

      load(id) {
        return loadHook(ctx).call(this, id);
      },

      transform(code, id) {
        return transformHook(ctx).call(this, code, id);
      },

      buildEnd() {
        return buildEndHook(ctx).call(this);
      },

      vite: {
        config: configHook(ctx),
        configResolved: configResolvedHook(ctx),
        configureServer: configureServerHook(ctx),
        transformIndexHtml: transformIndexHtmlHook(ctx),
        handleHotUpdate: handleHotUpdateHook(ctx),
        hotUpdate: handleHotUpdateHook(ctx),
      },
    },
  ];
};

export default createUnplugin(zintlFactory);
