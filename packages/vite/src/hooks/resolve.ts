import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZintlPluginContext } from "../context.js";
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
  return function (this: any, id: string, importer: string | undefined) {
    if (
      id.startsWith(VIRTUAL_PREFIX) ||
      id.startsWith(CHUNK_VIRTUAL_PREFIX) ||
      id.startsWith(CONTENT_VIRTUAL_PREFIX) ||
      id.startsWith(MANAGER_VIRTUAL_PREFIX)
    ) {
      ctx.compiler._logger.withPrefix("Vite").debug(`Resolving virtual module: ${id}`);
      return "\0" + id;
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
        return this.resolve(newId, importer, { skipSelf: true });
      }
    }
  };
}

export function loadHook(ctx: ZintlPluginContext) {
  return async function (this: any, id: string) {
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
    if (id.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
      const boundaryId = id.slice(RESOLVED_VIRTUAL_PREFIX.length + 1);
      vLogger.debug(`Loading legacy virtual catalog: ${boundaryId}`);
      const { code, watchedFiles } = await ctx.compiler.generateVirtualModule(boundaryId);

      for (const path of watchedFiles) {
        this.addWatchFile(path);
      }

      return code;
    }

    if (id.startsWith(RESOLVED_CHUNK_PREFIX)) {
      const prefix = CHUNK_VIRTUAL_PREFIX;
      const match = id.slice(1).match(new RegExp(`^${prefix}/([^:]+):(.+)$`));
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

    if (id.startsWith(RESOLVED_CONTENT_PREFIX)) {
      const prefix = CONTENT_VIRTUAL_PREFIX;
      const match = id.slice(1).match(new RegExp(`^${prefix}/([^/]+)/([^:]+):(.+)$`));
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

    if (id.startsWith(RESOLVED_MANAGER_PREFIX)) {
      const prefix = MANAGER_VIRTUAL_PREFIX;
      const match = id.slice(1).match(new RegExp(`^${prefix}/([^/]+)/([^:]+):(.+)$`));
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
