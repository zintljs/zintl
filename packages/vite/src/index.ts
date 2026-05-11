import type { Plugin, ResolvedConfig, HmrContext, ModuleNode, ViteDevServer } from "vite";
import { ZintlCompiler, type ZintlOptions, type LogLevel } from "@zintl/compiler";
import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import {
  VIRTUAL_PREFIX,
  RESOLVED_VIRTUAL_PREFIX,
  RESOLVED_CHUNK_PREFIX,
  PLUGIN_NAME,
  CHUNK_VIRTUAL_PREFIX,
  CONTENT_VIRTUAL_PREFIX,
  RESOLVED_CONTENT_PREFIX,
  MANAGER_VIRTUAL_PREFIX,
  RESOLVED_MANAGER_PREFIX,
} from "./constants.js";

/**
 * Zintl Vite Plugin
 * Handles message extraction and virtual catalog injection.
 */
export function zintl(
  options: ZintlOptions = {},
): Plugin & { __compiler: ZintlCompiler; __options: ZintlOptions } {
  let compiler: ZintlCompiler;
  let server: ViteDevServer | null = null;
  let multiplexEnabled: boolean | null = null;

  function getMultiplex(config?: any): boolean {
    if (multiplexEnabled !== null) return multiplexEnabled;
    const root = config?.root || compiler?.rootDir || process.cwd();

    if ((options as any).multiplex !== undefined) {
      multiplexEnabled = (options as any).multiplex;
      return multiplexEnabled!;
    }

    try {
      const mainPath = join(root, "src/main.ts");
      const indexPath = join(root, "index.html");

      let content = "";
      if (existsSync(mainPath)) {
        content += readFileSync(mainPath, "utf-8");
      }
      if (existsSync(indexPath)) {
        content += readFileSync(indexPath, "utf-8");
      }

      if (/zintl\(\s*['"]\*['"]\s*\)/.test(content) || /zintl\(\s*\)/.test(content)) {
        multiplexEnabled = true;
      } else {
        multiplexEnabled = false;
      }
    } catch {
      multiplexEnabled = false;
    }

    return multiplexEnabled;
  }

  function getMultiplexLocale(id: string): string | undefined {
    if (!id.includes("zintl-multiplex=")) return undefined;
    const match = id.match(/zintl-multiplex=([^&]+)/);
    return match ? match[1] : undefined;
  }

  return {
    name: PLUGIN_NAME,
    enforce: "pre",

    config(userConfig: any) {
      const multiplex = getMultiplex(userConfig);
      const locales = options.locales || ["en"];
      const configUpdate: any = {};

      if (options.debug) {
        configUpdate.define = {
          "process.env.ZINTL_DEBUG": JSON.stringify(
            options.debug === true ? "true" : options.debug,
          ),
        };
      }

      if (multiplex) {
        const userBuild = userConfig.build || {};
        const userRollupOptions = userBuild.rollupOptions || {};
        const userInput = userRollupOptions.input || "index.html";

        const inputObj: Record<string, string> = {};
        if (typeof userInput === "string") {
          inputObj.index = userInput;
        } else if (Array.isArray(userInput)) {
          userInput.forEach((inp, idx) => {
            const name = inp.replace(/\.html$/, "").replace(/[^a-zA-Z0-9]/g, "_");
            inputObj[name || `input_${idx}`] = inp;
          });
        } else if (typeof userInput === "object" && userInput !== null) {
          Object.assign(inputObj, userInput);
        }

        const expandedInput: Record<string, string> = { ...inputObj };
        for (const [key, val] of Object.entries(inputObj)) {
          if (val.endsWith(".html")) {
            for (const loc of locales) {
              const prefixKey = `${loc}/${key === "main" || key === "index" ? "index" : key}`;
              const prefixVal = `${loc}/${val}`;
              expandedInput[prefixKey] = prefixVal;
            }
          }
        }

        configUpdate.build = {
          ...userBuild,
          rollupOptions: {
            ...userRollupOptions,
            input: expandedInput,
          },
        };
      }

      return configUpdate;
    },

    configResolved(config: ResolvedConfig) {
      const logLevel = options.logLevel || (config as any).logLevel || "info";
      compiler = new ZintlCompiler(
        {
          verifyIntegrity: config.command === "build",
          ...options,
          logLevel: logLevel as LogLevel,
        },
        config.root,
        config.command === "serve",
      );
    },

    configureServer(_server: ViteDevServer) {
      server = _server;

      const multiplex = getMultiplex();
      if (multiplex) {
        const locales = options.locales || ["en"];
        _server.middlewares.use(async (req, res, next) => {
          const url = req.url || "/";
          const [pathname] = url.split("?");

          // Match /locale/ or /locale/index.html
          const match = pathname.match(/^\/([a-z]{2})(\/index\.html|\/)?$/);
          if (match) {
            const locale = match[1];
            if (locales.includes(locale)) {
              const originalPath = join(_server.config.root, "index.html");
              if (existsSync(originalPath)) {
                let html = readFileSync(originalPath, "utf-8");
                let dir = locale === "ar" ? "rtl" : "ltr";
                try {
                  const catalogPath = compiler.html.getCatalogPath("index.html", locale);
                  if (existsSync(catalogPath)) {
                    const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
                    const isMulti = compiler.isMultilingualFormat();
                    const catalogDir = isMulti ? cat.dir?.[locale] : cat.dir;
                    if (catalogDir !== undefined) {
                      dir = catalogDir;
                    }
                  }
                } catch {}

                html = html.replace(/<html([^>]*)>/i, (m, attrs) => {
                  let newAttrs = attrs;
                  if (!/lang=/i.test(attrs)) newAttrs += ` lang="${locale}"`;
                  else newAttrs = newAttrs.replace(/lang=["'][^"']*["']/i, `lang="${locale}"`);

                  if (!/dir=/i.test(attrs)) newAttrs += ` dir="${dir}"`;
                  else newAttrs = newAttrs.replace(/dir=["'][^"']*["']/i, `dir="${dir}"`);

                  return `<html${newAttrs}>`;
                });

                html = html.replace(
                  /(<script\s+[^>]*type=["']module["'][^>]*src=["'])([^"']*)(["'])/gi,
                  (m, prefix, src, suffix) => {
                    if (
                      src.includes("node_modules") ||
                      src.startsWith("http") ||
                      src.startsWith("//")
                    ) {
                      return m;
                    }
                    const separator = src.includes("?") ? "&" : "?";
                    return `${prefix}${src}${separator}zintl-multiplex=${locale}${suffix}`;
                  },
                );

                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html");
                return res.end(await _server.transformIndexHtml(url, html));
              }
            }
          }

          if (pathname === "/" || pathname === "/index.html") {
            const defaultLocale = options.sourceLocale || "en";
            const localesStr = JSON.stringify(locales);
            const redirectHtml = `
<!doctype html>
<html>
  <head>
    <script>
      const lang = (navigator.language || '${defaultLocale}').split('-')[0];
      const supported = ${localesStr};
      const target = supported.includes(lang) ? lang : '${defaultLocale}';
      window.location.replace('/' + target + '/');
    </script>
  </head>
</html>`;
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            return res.end(redirectHtml);
          }

          next();
        });
      }
    },

    async buildStart() {
      compiler._logger.withPrefix("Vite").debug("Build starting...");
      await compiler.setup();
      if (!server) {
        // Discovery pass for production builds
        await compiler.discover();
      }
    },

    resolveId(id: string, importer: string | undefined) {
      if (
        id.startsWith(VIRTUAL_PREFIX) ||
        id.startsWith(CHUNK_VIRTUAL_PREFIX) ||
        id.startsWith(CONTENT_VIRTUAL_PREFIX) ||
        id.startsWith(MANAGER_VIRTUAL_PREFIX)
      ) {
        compiler._logger.withPrefix("Vite").debug(`Resolving virtual module: ${id}`);
        return "\0" + id;
      }

      const multiplex = getMultiplex();
      if (multiplex && id.endsWith(".html")) {
        const locales = options.locales || ["en"];
        for (const loc of locales) {
          const pattern = new RegExp(`(^|\\/)${loc}\\/([^\\/]+\\.html)$`);
          if (pattern.test(id)) {
            const match = id.match(pattern);
            if (match) {
              return join(compiler.rootDir, `${loc}/${match[2]}`);
            }
          }
        }
      }

      // Propagate multiplexing to dependencies
      if (importer) {
        const locale = getMultiplexLocale(importer);
        if (locale && !id.includes("zintl-multiplex=")) {
          const cleanId = id.split("?")[0];
          const query = id.includes("?") ? id.split("?")[1] : "";
          const newId = `${cleanId}?${query ? query + "&" : ""}zintl-multiplex=${locale}`;
          return this.resolve(newId, importer, { skipSelf: true });
        }
      }
    },

    async load(id: string) {
      const multiplex = getMultiplex();
      if (multiplex && id.endsWith(".html")) {
        const locales = options.locales || ["en"];
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
          const originalPath = join(compiler.rootDir, originalHtmlFile);
          if (existsSync(originalPath)) {
            let html = readFileSync(originalPath, "utf-8");
            let dir = matchedLocale === "ar" ? "rtl" : "ltr";
            try {
              const catalogPath = compiler.html.getCatalogPath(originalHtmlFile, matchedLocale);
              if (existsSync(catalogPath)) {
                const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
                const isMulti = compiler.isMultilingualFormat();
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
                if (
                  src.includes("node_modules") ||
                  src.startsWith("http") ||
                  src.startsWith("//")
                ) {
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

      const vLogger = compiler._logger.withPrefix("Vite");
      if (id.startsWith(RESOLVED_VIRTUAL_PREFIX)) {
        const boundaryId = id.slice(RESOLVED_VIRTUAL_PREFIX.length + 1);
        vLogger.debug(`Loading legacy virtual catalog: ${boundaryId}`);
        const { code, watchedFiles } = await compiler.generateVirtualModule(boundaryId);

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
          const { code, watchedFiles } = await compiler.generateVirtualModule(fullModuleId);

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
          const { code, watchedFiles } = await compiler.generateVirtualModule(fullModuleId, locale);

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
          const { code, watchedFiles } = await compiler.generateVirtualModule(
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
    },

    async transform(code: string, id: string) {
      const vLogger = compiler._logger.withPrefix("Vite");
      if (id.includes("node_modules") || id.startsWith("\0")) return;

      const multiplexLocale = getMultiplexLocale(id);
      const cleanId = id.split("?")[0];

      const result = await compiler.transform(
        code,
        cleanId,
        VIRTUAL_PREFIX,
        false,
        multiplexLocale,
      );

      if (server && !id.startsWith("\0")) {
        const boundaryId = compiler.getNormalizedId(id);
        const affectedChunkIds = compiler.getAffectedChunks(boundaryId);

        if (affectedChunkIds.length > 0) {
          vLogger.debug(
            `Invalidating ${affectedChunkIds.length} affected chunks for ${boundaryId}`,
          );
          for (const chunkModuleId of affectedChunkIds) {
            for (const [modId, mod] of server.moduleGraph.idToModuleMap) {
              if (modId.includes(chunkModuleId) && modId.includes("virtual:zintl")) {
                vLogger.debug(`[HMR] Invalidating virtual module: ${modId}`);
                server.moduleGraph.invalidateModule(mod);
              }
            }
          }
        }
      }

      return result;
    },

    transformIndexHtml: {
      order: "post",
      async handler(html: string, ctx: any) {
        const vLogger = compiler._logger.withPrefix("Vite");
        vLogger.debug(`Transforming HTML: ${ctx.filename || ctx.path}`);

        const preloads: Record<string, string[]> = {};
        const base = (ctx.server?.config?.base || "") as string;

        if (ctx.bundle) {
          // Production Mode: Scan for virtual content chunks in the bundle
          for (const [fileName, chunk] of Object.entries(ctx.bundle as Record<string, any>)) {
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

        const filename = ctx.filename || ctx.path || "";
        const normalizedPath = filename.replace(/\\/g, "/");
        const cleanPath = normalizedPath.split("?")[0];
        const parts = cleanPath.split("/");
        const locales = options.locales || ["en"];
        const isFanned =
          parts.some((p: string) => locales.includes(p)) ||
          normalizedPath.includes("virtual:zintl-multiplex-html");

        if (getMultiplex() && !isFanned) {
          const localesStr = JSON.stringify(locales);
          const defaultLocale = options.sourceLocale || "en";
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
          const target = supported.includes(lang) ? lang : '${defaultLocale}';
          window.location.replace('/' + target + '/');
        } catch (e) {
          window.location.replace('/${defaultLocale}/');
        }
      })();
    </script>
  </head>
  <body>
  </body>
</html>`;
        }

        return await compiler.transformHtml(html, ctx.filename || ctx.path, preloads);
      },
    },

    async handleHotUpdate({ file, server, modules }: HmrContext) {
      const vLogger = compiler._logger.withPrefix("Vite");
      // Write Guard: If the compiler is currently writing this file, skip HMR
      // to prevent infinite loops.
      if (compiler.isWritingFile(file)) return;

      const isSource = /\.(ts|tsx|js|jsx|html)$/.test(file);
      const isJson = file.endsWith(".json");

      if (!isJson && !isSource) return;

      vLogger.debug(`HMR triggered for ${file}`);
      const invalidatedBoundaries = await compiler.invalidateFile(file);
      if (invalidatedBoundaries.length > 0) {
        vLogger.debug(`Invalidated ${invalidatedBoundaries.length} boundaries`);
      }

      // Non-Blocking Flush: We don't await the physical disk write during HMR.
      // The virtual modules will read the fresh data from the compiler's memory (the Hive) instantly.
      // The physical catalogs are updated in the background for persistence.
      compiler.flush().catch((e) => vLogger.error(`Background flush failed: ${String(e)}`));

      const invalidatedModules = new Set<ModuleNode>();

      let sourceBoundaryId: string | null = null;
      if (isSource) {
        sourceBoundaryId = compiler.getNormalizedId(file);
      }

      const boundaryIds = new Set(invalidatedBoundaries);
      if (sourceBoundaryId) boundaryIds.add(sourceBoundaryId);

      for (const boundaryId of boundaryIds) {
        // Ask compiler which chunks are affected by this boundary
        const affectedChunkIds = compiler.getAffectedChunks(boundaryId);

        for (const chunkModuleId of affectedChunkIds) {
          // Invalidate all virtual modules tied to this chunk (catalog, content, manager)
          for (const [id, mod] of server.moduleGraph.idToModuleMap) {
            if (id.includes(chunkModuleId) && id.includes("virtual:zintl")) {
              vLogger.debug(`Invalidating virtual module: ${id}`);
              server.moduleGraph.invalidateModule(mod);
              invalidatedModules.add(mod);
            }
          }
        }

        // Also handle legacy virtual modules if any
        const legacyVirtualId = `${RESOLVED_VIRTUAL_PREFIX}:${boundaryId}`;
        const legacyMod = server.moduleGraph.getModuleById(legacyVirtualId);
        if (legacyMod) {
          vLogger.debug(`Invalidating legacy virtual module: ${legacyVirtualId}`);
          server.moduleGraph.invalidateModule(legacyMod);
          invalidatedModules.add(legacyMod);
        }

        // Invalidate the source file itself (and its multiplexed query-param variants)
        let node = compiler.boundaryGraph?.nodes.get(boundaryId);
        if (!node) {
          for (const [nid, n] of compiler.boundaryGraph?.nodes.entries() || []) {
            if (compiler.ioManager.getSafeBoundaryId(nid) === boundaryId) {
              node = n;
              break;
            }
          }
        }
        const fileId = node?.filePath || boundaryId.split(":")[0];
        const absFileId = isAbsolute(fileId) ? fileId : join(compiler.rootDir, fileId);

        for (const [id, mod] of server.moduleGraph.idToModuleMap) {
          if (mod.file === absFileId || id.includes(fileId)) {
            vLogger.debug(`[HMR] Invalidating source module: ${id}`);
            server.moduleGraph.invalidateModule(mod);
            invalidatedModules.add(mod);
          }
        }

        // 4. If it's an HTML boundary, trigger full reload
        if (boundaryId.endsWith(".html")) {
          vLogger.debug(`[HMR] HTML boundary detected: ${boundaryId}. Triggering full reload.`);
          server.ws.send({ type: "full-reload", path: "*" });
        }
      }

      // If we found specific virtual modules to reload, we return ONLY those.
      // This "steals" the HMR event from the source file and prevents a full page reload
      // if the source file (like an entry point) isn't set up for HMR.
      if (invalidatedModules.size > 0) {
        return Array.from(new Set([...modules, ...invalidatedModules]));
      }

      // Otherwise, fall back to default Vite behavior
      return modules;
    },

    get __compiler() {
      return compiler;
    },
    get __options() {
      return options;
    },
    async buildEnd() {
      await compiler.flush();
    },
  } as any;
}
