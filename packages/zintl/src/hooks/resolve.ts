import { existsSync, readFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import type { ZintlPluginContext } from "../context.js";
import { generateMessageId, getRuntimeCode, sha1 } from "@zintl/compiler";
import {
  VIRTUAL_PREFIX,
  RESOLVED_VIRTUAL_PREFIX,
  RESOLVED_CHUNK_PREFIX,
  CHUNK_VIRTUAL_PREFIX,
  CONTENT_VIRTUAL_PREFIX,
  RESOLVED_CONTENT_PREFIX,
  MANAGER_VIRTUAL_PREFIX,
  RESOLVED_MANAGER_PREFIX,
  RUNTIME_VIRTUAL_ID,
  RUNTIME_INTERNAL_VIRTUAL_ID,
} from "../constants.js";

function injectMultiplexQuery(id: string, locale: string): string {
  const parts = id.split("?");
  const cleanId = parts[0];
  if (parts.length === 1) {
    return `${cleanId}?zintl-multiplex=${locale}`;
  }

  const query = parts[1];
  const params = query.split("&").filter((p) => !p.startsWith("zintl-multiplex="));
  if (params.length === 0) {
    return `${cleanId}?zintl-multiplex=${locale}`;
  }

  const lastParam = params[params.length - 1];
  if (lastParam && /\.(ts|tsx|js|jsx|mts|mjs|css|scss|less|html|vue|svelte)$/i.test(lastParam)) {
    const before = params.slice(0, -1);
    return `${cleanId}?${before.length ? before.join("&") + "&" : ""}zintl-multiplex=${locale}&${lastParam}`;
  }

  return `${cleanId}?${params.join("&")}&zintl-multiplex=${locale}`;
}

export function resolveIdHook(ctx: ZintlPluginContext) {
  return async function (
    this: any,
    id: string,
    importer: string | undefined,
    options?: { ssr?: boolean },
  ) {
    const isSsr = this.environment ? this.environment.config.consumer === "server" : !!options?.ssr;
    if (id.includes(".zintl-")) {
      const cleanId = id.split("?")[0];
      if (isAbsolute(cleanId)) {
        return id;
      }
    }

    if (id.startsWith(".") && importer && importer.includes(".zintl-")) {
      const cleanId = id.split("?")[0];
      const absolutePath = join(dirname(importer.split("?")[0]), cleanId);
      const suffix = id.includes("?") ? "?" + id.split("?")[1] : "";
      id = absolutePath + suffix;
    }

    if (
      id === RUNTIME_VIRTUAL_ID ||
      id === RUNTIME_INTERNAL_VIRTUAL_ID ||
      id.startsWith("virtual:zintl/runtime/")
    ) {
      return "\0" + id;
    }

    if (importer && importer.includes("virtual:zintl/runtime")) {
      if (id.startsWith("./")) {
        const cleanName = id.replace("./", "").replace(".js", "").replace(".mjs", "");
        return "\0virtual:zintl/runtime/" + cleanName;
      }
    }

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
    if (ctx.compiler.assets.isSupportedAsset(cleanId)) {
      let absolutePath = cleanId;
      if (cleanId.startsWith(".") && importer) {
        absolutePath = join(dirname(importer.split("?")[0]), cleanId);
      }
      await ctx.compiler.assets.registerAsset(absolutePath);
    }

    if (id.includes("zintl-multiplex=")) {
      const cleanId = id.split("?")[0];
      if (ctx.compiler.assets.isSupportedAsset(cleanId)) {
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

          if (ctx.options.virtualAssets) {
            return `\0virtual:zintl/asset/${locale}/${assetId}${suffix}`;
          }

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
      if (locale && !id.includes("zintl-multiplex=") && !id.includes(".zintl-")) {
        const cleanId = id.split("?")[0];
        const extMatch = cleanId.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : "";
        const isEligible =
          !ext ||
          ["js", "jsx", "ts", "tsx", "md", "txt", "vue", "svelte"].includes(ext) ||
          ctx.compiler.assets.isSupportedAsset(cleanId);

        if (isEligible) {
          // Resolve clean first to check for translation neutrality
          const resolvedClean = await this.resolve(id, importer, { skipSelf: true, ssr: isSsr });
          if (resolvedClean) {
            const cleanResolvedId = (
              typeof resolvedClean === "string" ? resolvedClean : resolvedClean.id
            ).split("?")[0];
            let isTranslationNeutral = false;
            if (ctx.compiler?.messages?.metadataGraph) {
              const startFileId = ctx.compiler.getNormalizedId(cleanResolvedId);
              const hasActiveZintlTransitive = (
                fileId: string,
                visited = new Set<string>(),
              ): boolean => {
                if (typeof fileId !== "string" || visited.has(fileId)) return false;
                visited.add(fileId);

                const cleanFileId = fileId.split("?")[0];
                const res = (() => {
                  if (ctx.compiler.assets.isSupportedAsset(cleanFileId)) return true;

                  const registeredAssets = ctx.compiler?.assets?.getRegisteredAssets() || [];
                  if (
                    registeredAssets.some(
                      (asset: string) =>
                        asset === cleanFileId || asset.startsWith(cleanFileId + "."),
                    )
                  ) {
                    return true;
                  }

                  const meta = ctx.compiler.messages.metadataGraph[cleanFileId];
                  if (meta) {
                    const hasOwnContent =
                      meta.hasZintlMarker ||
                      meta.hasZintlMacro ||
                      (meta.anchorSites && meta.anchorSites.length > 0) ||
                      meta.needsLoader;
                    if (hasOwnContent) return true;
                  }

                  const manifestKeys = Object.keys(ctx.compiler?.messages?.internalManifest || {});
                  for (const key of manifestKeys) {
                    if (key === cleanFileId || key.startsWith(cleanFileId + ":")) {
                      const msgs = ctx.compiler.messages.internalManifest[key];
                      if (msgs && msgs.length > 0) return true;
                    }
                  }

                  const deps = ctx.compiler.messages.dependencyGraph[cleanFileId];
                  if (deps) {
                    for (const dep of deps) {
                      const depId = typeof dep === "string" ? dep : dep?.id;
                      if (depId) {
                        const depFileId = depId.startsWith(".")
                          ? join(dirname(cleanFileId), depId)
                          : depId;
                        const nDepId = ctx.compiler.getNormalizedId(depFileId);
                        if (hasActiveZintlTransitive(nDepId, visited)) return true;
                      }
                    }
                  }
                  return false;
                })();
                return res;
              };

              isTranslationNeutral = !hasActiveZintlTransitive(startFileId);
            }

            if (isTranslationNeutral) {
              return resolvedClean;
            }
          }

          const isSfc = ext === "vue" || ext === "svelte";
          if (isSfc) {
            const resolved = await this.resolve(id, importer, { skipSelf: true, ssr: isSsr });
            if (resolved) {
              const resolvedId = typeof resolved === "string" ? resolved : resolved.id;
              const cleanResolvedId = resolvedId.split("?")[0];
              const suffix = resolvedId.includes("?") ? "?" + resolvedId.split("?")[1] : "";
              const finalId =
                cleanResolvedId.replace(/\.(vue|svelte)$/, `.zintl-${locale}.$1`) + suffix;
              if (typeof resolved === "string") {
                return finalId;
              }
              return {
                ...resolved,
                id: finalId,
              };
            }
          } else {
            const newId = injectMultiplexQuery(id, locale);

            const resolved = await this.resolve(newId, importer, { skipSelf: true, ssr: isSsr });
            if (resolved) {
              const resolvedId = typeof resolved === "string" ? resolved : resolved.id;
              const cleanResolvedId = resolvedId.split("?")[0];

              if (ctx.compiler.assets.isSupportedAsset(cleanResolvedId)) {
                await ctx.compiler.assets.registerAsset(cleanResolvedId);

                if (locale === (ctx.compiler as any).sourceLocale) {
                  return resolved;
                }

                const assetId = ctx.compiler.getNormalizedId(cleanResolvedId);
                const queries = resolvedId.split("?")[1] || "";
                const suffix = queries ? `?${queries}` : "";

                if (ctx.options.virtualAssets) {
                  const finalId = `\0virtual:zintl/asset/${locale}/${assetId}${suffix}`;
                  if (typeof resolved === "string") {
                    return finalId;
                  }
                  return {
                    ...resolved,
                    id: finalId,
                  };
                }

                const localizedPath = ctx.compiler.assets.getAssetPath(assetId, locale);

                if (existsSync(localizedPath)) {
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
              let finalResolvedId = resolvedId;
              if (!finalResolvedId.includes("zintl-multiplex=")) {
                finalResolvedId = injectMultiplexQuery(resolvedId, locale);
                if (typeof resolved === "string") {
                  return finalResolvedId;
                }
                return {
                  ...resolved,
                  id: finalResolvedId,
                };
              }
              return resolved;
            }
          }
        }
      }
    }
  };
}

export function loadHook(ctx: ZintlPluginContext) {
  return async function (this: any, id: string, options?: { ssr?: boolean }) {
    const isSsr = this.environment ? this.environment.config.consumer === "server" : !!options?.ssr;
    const cleanId = id.split("?")[0];
    if (cleanId.startsWith("\0virtual:zintl/asset/")) {
      const rest = cleanId.slice("\0virtual:zintl/asset/".length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx !== -1) {
        const locale = rest.slice(0, slashIdx);
        const assetId = rest.slice(slashIdx + 1);
        const originalPath = join(ctx.compiler.rootDir, assetId);

        if (existsSync(originalPath)) {
          this.addWatchFile(originalPath);
          const config = ctx.compiler.assets.resolveAssetConfig(assetId);

          if (config?.strategy === "binary-passthrough") {
            const sourceBuffer = readFileSync(originalPath);
            const sourceHashKey = `@zintl/asset-hash:${sha1(sourceBuffer)}`;
            const hive = (ctx.compiler as any).messages.hive;
            const sourceLocale = ctx.options.sourceLocale || "en";

            let buffer = sourceBuffer;
            if (locale !== sourceLocale) {
              const hiveBackup = hive?.[locale]?.[sourceHashKey];
              if (hiveBackup) {
                buffer = Buffer.from(hiveBackup, "base64");
              }
            }

            const referenceId = this.emitFile({
              type: "asset",
              name: assetId.split("/").pop(),
              source: buffer,
            });
            return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
          } else {
            const translations = await ctx.compiler.assets.getAssetTranslations(locale);
            const content =
              translations[`@zintl/asset:${assetId}`] ?? readFileSync(originalPath, "utf-8");

            if (id.includes("?raw") || id.includes("?zintl-raw")) {
              let code = `export default ${JSON.stringify(content)};`;
              if (ctx.compiler.isDev) {
                code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
              }
              return code;
            }

            const referenceId = this.emitFile({
              type: "asset",
              name: assetId.split("/").pop(),
              source: content,
            });
            return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
          }
        }
      }
    }
    if (
      cleanId.includes(".zintl-") &&
      !id.includes("?vue") &&
      !id.includes("&vue") &&
      !id.includes("?svelte") &&
      !id.includes("&svelte")
    ) {
      const originalPath = cleanId.replace(/\.zintl-[a-zA-Z0-9_-]+\.(vue|svelte)/, ".$1");
      if (existsSync(originalPath)) {
        const content = readFileSync(originalPath, "utf-8");
        this.addWatchFile(originalPath);
        return content;
      }
    }
    if (cleanId.startsWith("\0virtual:zintl/runtime")) {
      const moduleName = cleanId
        .replace("\0virtual:zintl/runtime/", "")
        .replace("\0virtual:zintl/runtime", "internal");
      ctx.compiler._logger
        .withPrefix("Vite")
        .debug(`Loading virtual runtime module: ${moduleName}`);
      let code = getRuntimeCode(
        moduleName as any,
        ctx.compiler._resolved.capabilities,
        isSsr,
        ctx.compiler.sourceLocale,
      );
      if (!isSsr) {
        code = code.replace(/await\s+import\(\s*["']node:async_hooks["']\s*\)/g, "null");
      }
      return code;
    }

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
import { getLocale, _t } from "virtual:zintl/runtime/internal";
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
              const finalSrc = injectMultiplexQuery(src, matchedLocale);
              return `${prefix}${finalSrc}${suffix}`;
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
