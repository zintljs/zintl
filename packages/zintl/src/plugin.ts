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

/**
 * The sliver of Rsbuild's plugin API this plugin uses.
 *
 * Declared structurally rather than imported. `zintljs` does not depend on
 * `@rsbuild/core` — Rsbuild is not a supported target, and adding an optional
 * peer would put a resolution warning in front of every Vite user to type one
 * property. Matches `@rsbuild/core@2.1.10`: `RsbuildPluginAPI.context` is a
 * `Readonly<RsbuildContext>` and `RsbuildContext.action` is
 * `'dev' | 'build' | 'preview' | undefined`.
 *
 * The real check on this shape is the contract suite, which drives a genuine
 * Rsbuild through `@zintljs/testing` — a package that *does* depend on it.
 */
interface RsbuildSetupApi {
  context: { action?: "dev" | "build" | "preview" };
}

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

      /**
       * The Rsbuild layer, which is a different layer from Rspack.
       *
       * unplugin hands a plugin Rspack's build context under both hosts —
       * `getNativeBuildContext()` reports `framework: "rspack"` even when
       * Rsbuild is driving — so anything only Rsbuild knows has to be asked for
       * here. `setup` runs during Rsbuild's plugin initialisation, before any
       * compilation and therefore before `buildStart`, which is what makes it a
       * usable place to answer a question compiler construction depends on.
       *
       * Structurally the twin of the `vite` block above, and that is the point:
       * which escape hatch a hook sits in *is* the statement of which layer owns
       * it. Rsbuild adds a dev-server, config and HTML layer on top of Rspack
       * and changes none of Rspack's module semantics, so `rspackFacet` keeps
       * the module-system concerns and this block keeps the rest.
       */
      rsbuild: {
        setup(api: RsbuildSetupApi) {
          /**
           * Rsbuild leaves `compiler.options.mode` at `"none"` in every action,
           * so the Rspack layer has no dev/production signal to read. `action`
           * is the documented one — `"dev"` is set by `rsbuild dev` and by
           * `rsbuild.startDevServer()` (ledger L-020).
           *
           * `"preview"` serves a production build, so it is deliberately not
           * dev: the page should have the production runtime it is previewing.
           */
          ctx.hostHints.isDev = api.context.action === "dev";
        },
      },
    },
  ];
});

export default unplugin;
