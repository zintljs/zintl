import { createUnplugin } from "unplugin";
import { PLUGIN_NAME } from "./constants.js";
import Context from "./context.js";
import type { Options } from "./types.ts";
import type { ResolvedOptions } from "./options.js";

import { configHook, configResolvedHook } from "./hooks/config.js";
import { configureServerHook } from "./hooks/server.js";
import { resolveIdHook, loadHook, loadIncludeHook } from "./hooks/resolve.js";
import {
  transformHook,
  transformIncludeHook,
  transformIndexHtmlHook,
  preTransformIndexHtmlHook,
} from "./hooks/transform.js";
import { handleHotUpdateHook } from "./hooks/hmr.js";
import { buildStartHook, buildEndHook } from "./hooks/build.js";
import { resolveOptions } from "./options.js";

const contextMap = new WeakMap<ResolvedOptions, Context>();

const unplugin = createUnplugin<Options, true>((options) => {
  const resolved = resolveOptions(options);
  const ctx = new Context(resolved);
  contextMap.set(resolved, ctx);

  if (typeof globalThis !== "undefined") {
    const activeContexts = globalThis as unknown as {
      __zintl_active_contexts?: Context[];
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

      loadInclude(id) {
        return loadIncludeHook(ctx)(id);
      },

      load(id) {
        return loadHook(ctx).call(this, id);
      },

      transformInclude(id) {
        return transformIncludeHook()(id);
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
});

export default unplugin;
