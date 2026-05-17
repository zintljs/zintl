import type { ZintlPluginContext } from "../context.js";
import { VIRTUAL_PREFIX } from "../constants.js";

export function transformHook(ctx: ZintlPluginContext) {
  return async function (code: string, id: string) {
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (id.includes("node_modules") || id.startsWith("\0")) return;

    const multiplexLocale = ctx.getMultiplexLocale(id);
    const cleanId = id.split("?")[0];

    const result = await ctx.compiler.transform(
      code,
      cleanId,
      VIRTUAL_PREFIX,
      false,
      multiplexLocale,
    );

    if (ctx.server && !id.startsWith("\0")) {
      const boundaryId = ctx.compiler.getNormalizedId(id);
      const affectedChunkIds = ctx.compiler.getAffectedChunks(boundaryId);

      if (affectedChunkIds.length > 0) {
        vLogger.debug(`Invalidating ${affectedChunkIds.length} affected chunks for ${boundaryId}`);
        for (const chunkModuleId of affectedChunkIds) {
          for (const [modId, mod] of ctx.server.moduleGraph.idToModuleMap) {
            if (modId.includes(chunkModuleId) && modId.includes("virtual:zintl")) {
              vLogger.debug(`[HMR] Invalidating virtual module: ${modId}`);
              ctx.server.moduleGraph.invalidateModule(mod);
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
      const filename = viteCtx.filename || viteCtx.path || "";
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

      return await ctx.compiler.transformHtml(html, viteCtx.filename || viteCtx.path, preloads);
    },
  };
}
