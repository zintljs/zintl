import type { Plugin, ResolvedConfig, HmrContext, ModuleNode, ViteDevServer } from "vite";
import { ZintlCompiler, type ZintlOptions, type LogLevel } from "@zintl/compiler";
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

  return {
    name: PLUGIN_NAME,
    enforce: "pre",

    config(_config: any) {
      if (options.debug) {
        return {
          define: {
            "process.env.ZINTL_DEBUG": JSON.stringify(
              options.debug === true ? "true" : options.debug,
            ),
          },
        };
      }
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
    },

    async buildStart() {
      compiler._logger.withPrefix("Vite").debug("Build starting...");
      await compiler.setup();
      if (!server) {
        // Discovery pass for production builds
        await compiler.discover();
      }
    },

    resolveId(id: string) {
      if (
        id.startsWith(VIRTUAL_PREFIX) ||
        id.startsWith(CHUNK_VIRTUAL_PREFIX) ||
        id.startsWith(CONTENT_VIRTUAL_PREFIX) ||
        id.startsWith(MANAGER_VIRTUAL_PREFIX)
      ) {
        compiler._logger.withPrefix("Vite").debug(`Resolving virtual module: ${id}`);
        return "\0" + id;
      }
    },

    async load(id: string) {
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

      const result = await compiler.transform(code, id, VIRTUAL_PREFIX);

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
