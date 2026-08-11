import { join, dirname } from "node:path";
import type Context from "../context.js";
import { ensureCompiler, nativeHostView } from "../host.js";
import { ensureDiscovered } from "./build.js";
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
    ensureCompiler(ctx, () => nativeHostView(this));
    const isSsr =
      this && this.environment ? this.environment.config.consumer === "server" : !!options?.ssr;
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    /**
     * The same once-per-process pass `buildStart` runs, awaited rather than
     * re-run — `hooks.make` is parallel on some hosts, so a module can reach
     * `transform` while discovery is still in flight, and proceeding then means
     * transforming against a null boundary graph. See {@link ensureDiscovered}.
     */
    await ensureDiscovered(ctx);
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

    /**
     * The second, independent invalidation path — driven from `transform`
     * rather than from a hot-update event, because here there is a module the
     * host has just asked to build but no changed file to describe it.
     *
     * It used to reach into Vite's `ModuleGraph` here, duplicating the
     * hot-update hook's walk. Routing it through the same applier is what makes
     * it reachable from a host with no `ModuleGraph` to reach into — and what
     * keeps its one genuinely awkward property, the `Date.now()` stamp, inside
     * the host that needs it rather than in shared code. That stamp is still a
     * clock of Zintl's own, which ZDB §7a is explicit about disliking; it is
     * unchanged here because there is no host event at this point to take a
     * sequence from, and inventing a better-looking one would not make it the
     * bundler's.
     */
    if (ctx.updateApplier && !id.startsWith("\0")) {
      const boundaryId = ctx.compiler.getNormalizedId(id);
      vLogger.debug(`Invalidating affected chunks for ${boundaryId}`);
      ctx.updateApplier.applyChunkInvalidation(boundaryId, {
        moduleGraph: this && this.environment ? this.environment.moduleGraph : undefined,
      });
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
