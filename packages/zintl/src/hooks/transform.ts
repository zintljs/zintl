import { join, dirname } from "node:path";
import type { ZintlPluginContext } from "../context.js";
import { VIRTUAL_PREFIX } from "../constants.js";

export function transformHook(ctx: ZintlPluginContext) {
  return async function (this: any, code: string, id: string, options?: { ssr?: boolean }) {
    const isSsr =
      this && this.environment ? this.environment.config.consumer === "server" : !!options?.ssr;
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (
      id.includes("node_modules") ||
      id.startsWith("\0") ||
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
        for (const chunkModuleId of affectedChunkIds) {
          for (const [modId, mod] of mg.idToModuleMap) {
            if (modId.includes(chunkModuleId) && modId.includes("virtual:zintl")) {
              vLogger.debug(`[HMR] Invalidating virtual module: ${modId}`);
              mg.invalidateModule(mod);
            }
          }
        }
      }
    }

    return result;
  };
}

export function transformIndexHtmlHook(ctx: ZintlPluginContext) {
  return {
    order: "post" as const,
    async handler(html: string, viteCtx: any) {
      let htmlId = viteCtx.filename || viteCtx.path || "";
      if (viteCtx.path) {
        const pathParts = viteCtx.path.split("/").filter(Boolean);
        const locales = ctx.options.locales || ["en"];
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
      const locales = ctx.options.locales || ["en"];
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
