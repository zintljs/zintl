import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ZintlPluginContext } from "../context.js";
import { generateMessageId } from "@zintl/compiler";
import {
  VIRTUAL_PREFIX,
  RESOLVED_VIRTUAL_PREFIX,
  RESOLVED_CHUNK_PREFIX,
  CHUNK_VIRTUAL_PREFIX,
  CONTENT_VIRTUAL_PREFIX,
  RESOLVED_CONTENT_PREFIX,
  MANAGER_VIRTUAL_PREFIX,
  RESOLVED_MANAGER_PREFIX,
} from "../constants.js";

export function resolveIdHook(ctx: ZintlPluginContext) {
  return async function (this: any, id: string, importer: string | undefined) {
    if (
      id.startsWith(VIRTUAL_PREFIX) ||
      id.startsWith(CHUNK_VIRTUAL_PREFIX) ||
      id.startsWith(CONTENT_VIRTUAL_PREFIX) ||
      id.startsWith(MANAGER_VIRTUAL_PREFIX)
    ) {
      ctx.compiler._logger.withPrefix("Vite").debug(`Resolving virtual module: ${id}`);
      return "\0" + id;
    }

    const cleanId = id.split("?")[0];
    if (cleanId.endsWith(".md") || cleanId.endsWith(".txt")) {
      let absolutePath = cleanId;
      if (cleanId.startsWith(".") && importer) {
        absolutePath = join(dirname(importer.split("?")[0]), cleanId);
      }
      await ctx.compiler.assets.registerAsset(absolutePath);
    }

    if (id.includes("zintl-multiplex=")) {
      const cleanId = id.split("?")[0];
      if (cleanId.endsWith(".md") || cleanId.endsWith(".txt")) {
        const locale = ctx.getMultiplexLocale(id);
        if (locale) {
          let absolutePath = cleanId;
          if (cleanId.startsWith(".") && importer) {
            absolutePath = join(dirname(importer.split("?")[0]), cleanId);
          }

          await ctx.compiler.assets.registerAsset(absolutePath);

          const queries = id.split("?")[1] || "";
          const cleanQueries = queries
            .split("&")
            .filter((q) => !q.startsWith("zintl-multiplex="))
            .join("&");
          const suffix = cleanQueries ? `?${cleanQueries}` : "";

          if (locale === (ctx.compiler as any).sourceLocale) {
            return absolutePath + suffix;
          }

          const assetId = ctx.compiler.getNormalizedId(absolutePath);
          const localizedPath = ctx.compiler.assets.getAssetPath(assetId, locale);

          if (existsSync(localizedPath)) {
            return localizedPath + suffix;
          }
          return absolutePath + suffix;
        }
      }
    }

    const multiplex = ctx.getMultiplex();
    if (multiplex && id.endsWith(".html")) {
      const locales = ctx.options.locales || ["en"];
      for (const loc of locales) {
        const pattern = new RegExp(`(^|\\/)${loc}\\/([^\\/]+\\.html)$`);
        if (pattern.test(id)) {
          const match = id.match(pattern);
          if (match) {
            return join(ctx.compiler.rootDir, `${loc}/${match[2]}`);
          }
        }
      }
    }

    // Propagate multiplexing to dependencies
    if (importer) {
      const locale = ctx.getMultiplexLocale(importer);
      if (locale && !id.includes("zintl-multiplex=")) {
        const cleanId = id.split("?")[0];
        const query = id.includes("?") ? id.split("?")[1] : "";
        const newId = `${cleanId}?${query ? query + "&" : ""}zintl-multiplex=${locale}`;

        const resolved = await this.resolve(newId, importer, { skipSelf: true });
        if (resolved) {
          const resolvedId = typeof resolved === "string" ? resolved : resolved.id;
          const cleanResolvedId = resolvedId.split("?")[0];

          if (cleanResolvedId.endsWith(".md") || cleanResolvedId.endsWith(".txt")) {
            await ctx.compiler.assets.registerAsset(cleanResolvedId);

            if (locale === (ctx.compiler as any).sourceLocale) {
              return resolved;
            }

            const assetId = ctx.compiler.getNormalizedId(cleanResolvedId);
            const localizedPath = ctx.compiler.assets.getAssetPath(assetId, locale);

            if (existsSync(localizedPath)) {
              const queries = resolvedId.split("?")[1] || "";
              const suffix = queries ? `?${queries}` : "";
              const finalId = localizedPath + suffix;

              if (typeof resolved === "string") {
                return finalId;
              }
              return {
                ...resolved,
                id: finalId,
              };
            }
          }
          return resolved;
        }
      }
    }
  };
}

export function loadHook(ctx: ZintlPluginContext) {
  return async function (this: any, id: string) {
    const cleanId = id.split("?")[0];
    if (cleanId.endsWith(".md") || cleanId.endsWith(".txt")) {
      if (existsSync(cleanId)) {
        const content = readFileSync(cleanId, "utf-8");
        const ext = cleanId.endsWith(".md") ? ".md" : ".txt";
        const translationOnly = ctx.compiler.assets.getTranslationOnly(content, ext);
        this.addWatchFile(cleanId);

        if (id.includes("?zintl-raw")) {
          let code = `export default ${JSON.stringify(translationOnly)};`;
          if (ctx.compiler.isDev) {
            code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
          }
          return code;
        }

        const assetId = ctx.compiler.getNormalizedId(cleanId);
        await ctx.compiler.assets.registerAsset(cleanId);

        if (id.includes("?raw")) {
          const multiplexLocale = ctx.getMultiplexLocale(id);
          const sourceLocale = ctx.options.sourceLocale || "en";

          if (multiplexLocale) {
            const localizedPath =
              multiplexLocale === sourceLocale
                ? cleanId
                : ctx.compiler.assets.getAssetPath(assetId, multiplexLocale);

            const content = existsSync(localizedPath)
              ? readFileSync(localizedPath, "utf-8")
              : translationOnly;
            let code = `export default ${JSON.stringify(content)};`;
            if (ctx.compiler.isDev) {
              code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
            }
            return code;
          }

          const locales = ctx.options.locales || ["en"];
          for (const loc of locales) {
            if (loc === sourceLocale) continue;
            const localizedPath = ctx.compiler.assets.getAssetPath(assetId, loc);
            if (existsSync(localizedPath)) {
              this.addWatchFile(localizedPath);
            }
          }

          const rawAssetKey = `@zintl/asset:${assetId}`;
          const assetKey = ctx.compiler.isDev ? rawAssetKey : generateMessageId(rawAssetKey);
          return `
import { getLocale, _t } from "zintl/internal";
const sourceContent = ${JSON.stringify(translationOnly)};
const assetKey = ${JSON.stringify(assetKey)};
const proxy = new Proxy({}, {
  get(target, prop) {
    const multiplexLocale = ${JSON.stringify(ctx.getMultiplexLocale(id) || null)};
    const loc = getLocale() || multiplexLocale || ${JSON.stringify(sourceLocale)};
    const val = loc === ${JSON.stringify(sourceLocale)}
      ? sourceContent
      : (_t(assetKey, {}, { _bId: "b_assets" }) || sourceContent);
    if (prop === Symbol.toPrimitive) {
      return () => val;
    }
    if (prop === "toString" || prop === "valueOf") {
      return () => val;
    }
    if (prop === "toJSON") {
      return () => val;
    }
    if (typeof val[prop] === "function") {
      return val[prop].bind(val);
    }
    return val[prop];
  }
});
export default proxy;
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
        }
        return translationOnly;
      }
    }

    const multiplex = ctx.getMultiplex();
    if (multiplex && id.endsWith(".html")) {
      const locales = ctx.options.locales || ["en"];
      let isFanned = false;
      let matchedLocale = "";
      let originalHtmlFile = "";

      for (const loc of locales) {
        const pattern = new RegExp(`[\\/\\\\]${loc}[\\/\\\\]([^\\/\\\\]+\\.html)$`);
        const m = id.match(pattern);
        if (m) {
          isFanned = true;
          matchedLocale = loc;
          originalHtmlFile = m[1];
          break;
        }
      }

      if (isFanned) {
        const originalPath = join(ctx.compiler.rootDir, originalHtmlFile);
        if (existsSync(originalPath)) {
          let html = readFileSync(originalPath, "utf-8");
          let dir = matchedLocale === "ar" ? "rtl" : "ltr";
          try {
            const catalogPath = ctx.compiler.html.getCatalogPath(originalHtmlFile, matchedLocale);
            if (existsSync(catalogPath)) {
              const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
              const isMulti = ctx.compiler.isMultilingualFormat();
              const catalogDir = isMulti ? cat.dir?.[matchedLocale] : cat.dir;
              if (catalogDir !== undefined) {
                dir = catalogDir;
              }
            }
          } catch {}

          html = html.replace(/<html([^>]*)>/i, (m, attrs) => {
            let newAttrs = attrs;
            if (!/lang=/i.test(attrs)) newAttrs += ` lang="${matchedLocale}"`;
            else newAttrs = newAttrs.replace(/lang=["'][^"']*["']/i, `lang="${matchedLocale}"`);

            if (!/dir=/i.test(attrs)) newAttrs += ` dir="${dir}"`;
            else newAttrs = newAttrs.replace(/dir=["'][^"']*["']/i, `dir="${dir}"`);

            return `<html${newAttrs}>`;
          });

          html = html.replace(
            /(<script\s+[^>]*type=["']module["'][^>]*src=["'])([^"']*)(["'])/gi,
            (m, prefix, src, suffix) => {
              if (src.includes("node_modules") || src.startsWith("http") || src.startsWith("//")) {
                return m;
              }
              const separator = src.includes("?") ? "&" : "?";
              return `${prefix}${src}${separator}zintl-multiplex=${matchedLocale}${suffix}`;
            },
          );

          return html;
        }
      } else {
        const normalizedPath = id.replace(/\\/g, "/");
        if (!normalizedPath.includes("node_modules")) {
          if (existsSync(id)) {
            let html = readFileSync(id, "utf-8");
            html = html.replace(
              /<script[^>]*src=["'][^"']*(src\/main\.ts|main\.ts)["'][^>]*>([\s\S]*?)<\/script>/gi,
              "",
            );
            return html;
          }
        }
      }
    }

    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (cleanId.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
      const boundaryId = cleanId.slice(RESOLVED_VIRTUAL_PREFIX.length + 1);
      vLogger.debug(`Loading legacy virtual catalog: ${boundaryId}`);
      const { code, watchedFiles } = await ctx.compiler.generateVirtualModule(boundaryId);

      for (const path of watchedFiles) {
        this.addWatchFile(path);
      }

      return code;
    }

    if (cleanId.startsWith(RESOLVED_CHUNK_PREFIX)) {
      const prefix = CHUNK_VIRTUAL_PREFIX;
      const match = cleanId.slice(1).match(new RegExp(`^${prefix}/([^:]+):(.+)$`));
      if (match) {
        const [, chunkType, chunkId] = match;
        vLogger.debug(`Loading chunk [${chunkType}]: ${chunkId}`);
        const fullModuleId = `${chunkType}:${chunkId}`;
        const { code, watchedFiles } = await ctx.compiler.generateVirtualModule(fullModuleId);

        for (const path of watchedFiles) {
          this.addWatchFile(path);
        }

        return code;
      }
    }

    if (cleanId.startsWith(RESOLVED_CONTENT_PREFIX)) {
      const prefix = CONTENT_VIRTUAL_PREFIX;
      const match = cleanId.slice(1).match(new RegExp(`^${prefix}/([^/]+)/([^:]+):(.+)$`));
      if (match) {
        const [, locale, chunkType, chunkId] = match;
        vLogger.debug(`Loading content [${locale}] for [${chunkType}]: ${chunkId}`);
        const fullModuleId = `${chunkType}:${chunkId}`;
        const { code, watchedFiles } = await ctx.compiler.generateVirtualModule(
          fullModuleId,
          locale,
        );

        for (const path of watchedFiles) {
          this.addWatchFile(path);
        }

        return code;
      }
    }

    if (cleanId.startsWith(RESOLVED_MANAGER_PREFIX)) {
      const prefix = MANAGER_VIRTUAL_PREFIX;
      const match = cleanId.slice(1).match(new RegExp(`^${prefix}/([^/]+)/([^:]+):(.+)$`));
      if (match) {
        const [, syncLocale, chunkType, chunkId] = match;
        const locale = syncLocale === "none" ? undefined : syncLocale;
        vLogger.debug(`Loading manager [${syncLocale}] for [${chunkType}]: ${chunkId}`);
        const fullModuleId = `${chunkType}:${chunkId}`;
        const { code, watchedFiles } = await ctx.compiler.generateVirtualModule(
          fullModuleId,
          locale,
          true,
        );

        for (const path of watchedFiles) {
          this.addWatchFile(path);
        }

        return code;
      }
    }
  };
}
