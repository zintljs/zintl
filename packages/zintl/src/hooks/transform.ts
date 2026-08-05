import { join, dirname } from "node:path";
import type Context from "../context.js";
import { ensureCompiler, nativeHostView } from "../host.js";
import { VIRTUAL_PREFIX } from "../constants.js";

/**
 * Which ids {@link transformHook} may rewrite.
 *
 * HTML is the whole point of this filter. Zintl does transform HTML, but never
 * here — projections and the bootstrap script go through `transformIndexHtml`
 * and `compiler.transformHtml()`. On Vite that separation needed no enforcement
 * because HTML is not a module in the graph, so it simply never arrived at
 * `transform`.
 *
 * On Rspack it does: the HTML template is processed through a loader chain, and
 * unplugin inserts this hook into it. Zintl then rewrote the template as if it
 * were a source module and handed JavaScript-shaped output to a parser that got
 * `<!doctype html>`.
 *
 * So the rule the code always relied on — "everything reaching `transform` is a
 * script module" — is now stated rather than assumed.
 */
export function transformIncludeHook() {
  return function (id: string): boolean {
    return !id.split("?")[0].endsWith(".html");
  };
}

export function transformHook(ctx: Context) {
  return async function (this: any, code: string, id: string, options?: { ssr?: boolean }) {
    ensureCompiler(ctx, nativeHostView(this));
    const isSsr =
      this && this.environment ? this.environment.config.consumer === "server" : !!options?.ssr;
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (ctx.server && !(ctx as any).discovered) {
      (ctx as any).discovered = true;
      try {
        await ctx.compiler.discover();
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;
      }
    }
    const isTargetSsrEntry = ctx.compiler?.isSsrEntryTarget?.(id);
    if (
      (id.includes("node_modules") && !isTargetSsrEntry) ||
      (id.startsWith("\0") && !isTargetSsrEntry) ||
      id.includes("?vue") ||
      id.includes("&vue") ||
      id.includes("?svelte") ||
      id.includes("&svelte") ||
      (id.includes("?") && !id.includes("zintl-multiplex="))
    )
      return;

    const multiplexLocale = ctx.getMultiplexLocale(id);
    const cleanId = id.split("?")[0];

    const result = await ctx.compiler.transform(
      code,
      cleanId,
      VIRTUAL_PREFIX,
      false,
      multiplexLocale,
      isSsr,
    );

    const mg = this && this.environment ? this.environment.moduleGraph : ctx.server?.moduleGraph;
    if (mg && !id.startsWith("\0")) {
      const boundaryId = ctx.compiler.getNormalizedId(id);
      const affectedChunkIds = ctx.compiler.getAffectedChunks(boundaryId);

      if (affectedChunkIds.length > 0) {
        vLogger.debug(`Invalidating ${affectedChunkIds.length} affected chunks for ${boundaryId}`);
        /**
         * Stamp the invalidation, the same way the hot-update hook does.
         *
         * This is a second, independent invalidation path, and it set no
         * timestamp at all — so modules invalidated from here carried no
         * ordering token, and the bundler had nothing to rewrite their import
         * query with. Two of these racing produced fetches the browser could
         * apply in either order.
         */
        const stamp = Date.now();
        for (const chunkModuleId of affectedChunkIds) {
          for (const [modId, mod] of mg.idToModuleMap) {
            if (modId.includes(chunkModuleId) && modId.includes("virtual:zintl")) {
              vLogger.debug(`[HMR] Invalidating virtual module: ${modId}`);
              mg.invalidateModule(mod);
              mod.lastHMRTimestamp = stamp;
            }
          }
        }
      }
    }

    return result;
  };
}

export function transformIndexHtmlHook(ctx: Context) {
  return {
    order: "post" as const,
    async handler(html: string, viteCtx: any) {
      let htmlId = viteCtx.filename || viteCtx.path || "";
      if (viteCtx.path) {
        const pathParts = viteCtx.path.split("/").filter(Boolean);
        const locales = ctx.options.locales;
        const foundLocale = pathParts.find((p: string) => locales.includes(p));
        if (foundLocale) {
          const pathName = pathParts.filter((p: string) => p !== foundLocale).join("/");
          const baseName = pathName
            ? pathName.endsWith(".html")
              ? pathName
              : `${pathName}/index.html`
            : "index.html";
          const dir = dirname(htmlId);
          htmlId = join(dir, foundLocale, baseName);
        }
      }

      const filename = htmlId;
      const normalizedPath = filename.replace(/\\/g, "/");
      const cleanPath = normalizedPath.split("?")[0];
      const parts = cleanPath.split("/");
      const locales = ctx.options.locales;
      const isFanned =
        parts.some((p: string) => locales.includes(p)) ||
        normalizedPath.includes("virtual:zintl-multiplex-html");

      if (ctx.getMultiplex() && !isFanned) {
        return html;
      }

      const preloads: Record<string, string[]> = {};
      const base = (viteCtx.server?.config?.base || "") as string;

      if (viteCtx.bundle) {
        // Production Mode: Scan for virtual content chunks in the bundle
        for (const [fileName, chunk] of Object.entries(viteCtx.bundle as Record<string, any>)) {
          if (chunk.type === "chunk") {
            for (const modId of chunk.moduleIds) {
              // Check if this chunk contains a Zintl content module
              // Format: \0virtual:zintl/content/<locale>/<chunkType>:<stableId>
              const match = modId.match(/virtual:zintl\/content\/([^/]+)\//);
              if (match) {
                const locale = match[1];
                if (!preloads[locale]) preloads[locale] = [];
                const url = `${base}${fileName}`;
                if (!preloads[locale].includes(url)) {
                  preloads[locale].push(url);
                }
              }
            }
          }
        }
      }

      return await ctx.compiler.transformHtml(html, htmlId, preloads);
    },
  };
}

export function preTransformIndexHtmlHook(ctx: Context) {
  return {
    order: "pre" as const,
    handler(html: string, viteCtx: any) {
      const filename = viteCtx.filename || viteCtx.path || "";
      const normalizedPath = filename.replace(/\\/g, "/");
      const parts = normalizedPath.split("?")[0].split("/");
      const locales = ctx.options.locales;
      const pathParts = (viteCtx.path || "").split("/").filter(Boolean);
      const isFanned =
        parts.some((p: string) => locales.includes(p)) ||
        pathParts.some((p: string) => locales.includes(p)) ||
        normalizedPath.includes("virtual:zintl-multiplex-html");

      const isMultiplex = ctx.getMultiplex();

      if (isMultiplex && !isFanned) {
        const localesStr = JSON.stringify(locales);
        const defaultLocale = ctx.options.sourceLocale;
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
  };
}
