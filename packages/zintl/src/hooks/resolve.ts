import { existsSync, readFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import type Context from "../context.js";
import { ensureCompiler, nativeHostView } from "../host.js";
import { generateMessageId, getRuntimeCode, sha1 } from "@zintljs/compiler";
import type { AssetManager, HtmlManager } from "@zintljs/compiler/facets";
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

export function resolveIdHook(ctx: Context) {
  return async function (
    this: any,
    id: string,
    importer: string | undefined,
    options?: { ssr?: boolean },
  ) {
    ensureCompiler(ctx, () => nativeHostView(this));
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
    if ((ctx.compiler.assets as AssetManager).isSupportedAsset(cleanId)) {
      let absolutePath = cleanId;
      if (cleanId.startsWith(".") && importer) {
        absolutePath = join(dirname(importer.split("?")[0]), cleanId);
      }
      await (ctx.compiler.assets as AssetManager).registerAsset(absolutePath);
    }

    if (id.includes("zintl-multiplex=")) {
      const cleanId = id.split("?")[0];
      if ((ctx.compiler.assets as AssetManager).isSupportedAsset(cleanId)) {
        const locale = ctx.getMultiplexLocale(id);
        if (locale) {
          let absolutePath = cleanId;
          if (cleanId.startsWith(".") && importer) {
            absolutePath = join(dirname(importer.split("?")[0]), cleanId);
          }

          await (ctx.compiler.assets as AssetManager).registerAsset(absolutePath);

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

          const localizedPath = (ctx.compiler.assets as AssetManager).getAssetPath(assetId, locale);

          if (existsSync(localizedPath)) {
            return localizedPath + suffix;
          }
          return absolutePath + suffix;
        }
      }
    }

    const multiplex = ctx.getMultiplex();
    if (multiplex && id.endsWith(".html")) {
      const locales = ctx.options.locales;
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

        {
          /**
           * Resolve first, then ask the graph.
           *
           * There used to be a hardcoded extension allow-list here — `js`, `ts`,
           * `vue`, `svelte`… — gating whether the edge was even considered. It
           * was app-agnostic (a Vue-only app paid for `.svelte`) and it was
           * answering the wrong question: "might this file contain strings" is a
           * guess, where "does my graph place this module inside translated
           * content" is a fact the compiler already holds.
           *
           * What remains of the bundler's involvement is the resolution itself:
           * the graph is keyed by file ids, so a bare or aliased specifier has
           * to become a path before it can be looked up. That residue is real,
           * and it is much smaller than the traversal it replaced.
           */
          const resolvedClean = await this.resolve(id, importer, { skipSelf: true, ssr: isSsr });
          if (resolvedClean) {
            const cleanResolvedId = (
              typeof resolvedClean === "string" ? resolvedClean : resolvedClean.id
            ).split("?")[0];

            if (ctx.compiler.isTranslationNeutral(cleanResolvedId)) {
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

              if ((ctx.compiler.assets as AssetManager).isSupportedAsset(cleanResolvedId)) {
                await (ctx.compiler.assets as AssetManager).registerAsset(cleanResolvedId);

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

                const localizedPath = (ctx.compiler.assets as AssetManager).getAssetPath(
                  assetId,
                  locale,
                );

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

/**
 * Which ids {@link loadHook} may return content for.
 *
 * On Rollup and Vite this is an optimisation: an unfiltered `load` that returns
 * `undefined` is a no-op, so declaring the filter only saves calls.
 *
 * On Rspack it is **load-bearing**. Unplugin implements `load` as a module rule
 * carrying `type: "javascript/auto"`, and the rule's `include()` is this
 * predicate. A hook with no filter matches every module in the graph and
 * retypes all of them as JavaScript — so the HTML template reaches the JS
 * parser and the build dies on `<!doctype html>`. Merely *claiming* a module is
 * destructive there, where on Rollup it is free.
 *
 * That asymmetry is why this must be exact rather than generous. In particular
 * `.html` is claimed only under multiplex, which is the sole mode where
 * {@link loadHook} returns HTML; claiming it unconditionally would reintroduce
 * the retyping bug for every non-multiplex app.
 */
export function loadIncludeHook(ctx: Context) {
  return function (id: string): boolean {
    const cleanId = id.split("?")[0];

    if (cleanId.startsWith("\0virtual:zintl/") || cleanId.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
      return true;
    }
    if (cleanId.includes(".zintl-")) return true;
    if (cleanId.endsWith(".md") || cleanId.endsWith(".txt")) return true;
    if (cleanId.endsWith(".html")) return ctx.getMultiplex();

    return false;
  };
}

export function loadHook(ctx: Context) {
  return async function (this: any, id: string, options?: { ssr?: boolean }) {
    ensureCompiler(ctx, () => nativeHostView(this));
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
          const config = (ctx.compiler.assets as AssetManager).resolveAssetConfig(assetId);

          if (config?.strategy === "binary-passthrough") {
            const sourceBuffer = readFileSync(originalPath);
            const sourceHashKey = `@zintl/asset-hash:${sha1(sourceBuffer)}`;
            const hive = (ctx.compiler as any).messages.hive;
            const sourceLocale = ctx.options.sourceLocale;

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
            const translations = await (ctx.compiler.assets as AssetManager).getAssetTranslations(
              locale,
            );
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
        ctx.compiler._resolved.flags,
        isSsr,
        ctx.compiler.sourceLocale,
        ctx.compiler.isDev,
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
        const translationOnly = (ctx.compiler.assets as AssetManager).getTranslationOnly(
          content,
          ext,
        );
        this.addWatchFile(cleanId);

        if (id.includes("?zintl-raw")) {
          let code = `export default ${JSON.stringify(translationOnly)};`;
          if (ctx.compiler.isDev) {
            code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
          }
          return code;
        }

        const assetId = ctx.compiler.getNormalizedId(cleanId);
        await (ctx.compiler.assets as AssetManager).registerAsset(cleanId);

        if (id.includes("?raw")) {
          const multiplexLocale = ctx.getMultiplexLocale(id);
          const sourceLocale = ctx.options.sourceLocale;

          if (multiplexLocale) {
            const localizedPath =
              multiplexLocale === sourceLocale
                ? cleanId
                : (ctx.compiler.assets as AssetManager).getAssetPath(assetId, multiplexLocale);

            const content = existsSync(localizedPath)
              ? readFileSync(localizedPath, "utf-8")
              : translationOnly;
            let code = `export default ${JSON.stringify(content)};`;
            if (ctx.compiler.isDev) {
              code += "\nif (import.meta.hot) { import.meta.hot.accept(); }";
            }
            return code;
          }

          const locales = ctx.options.locales;
          for (const loc of locales) {
            if (loc === sourceLocale) continue;
            const localizedPath = (ctx.compiler.assets as AssetManager).getAssetPath(assetId, loc);
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
${
  /**
   * Dev-guarded, like the `?zintl-raw` branch above it — which this one was not.
   *
   * On Vite the omission was invisible: production folds `import.meta.hot` to
   * `undefined` and the branch is eliminated, so nothing shipped. That is a Vite
   * guarantee this code was silently relying on. Rspack performs no such
   * substitution, so the accept call reached the production bundle intact
   * (ledger L-014) — "nothing ships that isn't used", upheld by the host rather
   * than by us.
   */
  ctx.compiler.isDev ? "if (import.meta.hot) {\n  import.meta.hot.accept();\n}" : ""
}
`;
        }
        return translationOnly;
      }
    }

    const multiplex = ctx.getMultiplex();
    if (multiplex && id.endsWith(".html")) {
      const locales = ctx.options.locales;
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
            const catalogPath = (ctx.compiler.html as HtmlManager).getCatalogPath(
              originalHtmlFile,
              matchedLocale,
            );
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
