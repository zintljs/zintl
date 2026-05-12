import type { HmrContext, ModuleNode } from "vite";
import { isAbsolute, join } from "node:path";
import type { ZintlPluginContext } from "../context.js";
import { RESOLVED_VIRTUAL_PREFIX } from "../constants.js";

export function handleHotUpdateHook(ctx: ZintlPluginContext) {
  return async function ({ file, server, modules }: HmrContext) {
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    // Write Guard: If the compiler is currently writing this file, skip HMR
    // to prevent infinite loops.
    if (ctx.compiler.isWritingFile(file)) return;

    const isSource = /\.(ts|tsx|js|jsx|html)$/.test(file);
    const isJson = file.endsWith(".json");

    if (!isJson && !isSource) return;

    vLogger.debug(`HMR triggered for ${file}`);
    const invalidatedBoundaries = await ctx.compiler.invalidateFile(file);
    if (invalidatedBoundaries.length > 0) {
      vLogger.debug(`Invalidated ${invalidatedBoundaries.length} boundaries`);
    }

    // Non-Blocking Flush: We don't await the physical disk write during HMR.
    // The virtual modules will read the fresh data from the compiler's memory (the Hive) instantly.
    // The physical catalogs are updated in the background for persistence.
    ctx.compiler.flush().catch((e) => vLogger.error(`Background flush failed: ${String(e)}`));

    const invalidatedModules = new Set<ModuleNode>();

    let sourceBoundaryId: string | null = null;
    if (isSource) {
      sourceBoundaryId = ctx.compiler.getNormalizedId(file);
    }

    const boundaryIds = new Set(invalidatedBoundaries);
    if (sourceBoundaryId) boundaryIds.add(sourceBoundaryId);

    for (const boundaryId of boundaryIds) {
      // Ask compiler which chunks are affected by this boundary
      const affectedChunkIds = ctx.compiler.getAffectedChunks(boundaryId);

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
      let node = ctx.compiler.boundaryGraph?.nodes.get(boundaryId);
      if (!node) {
        for (const [nid, n] of ctx.compiler.boundaryGraph?.nodes.entries() || []) {
          if (ctx.compiler.ioManager.getSafeBoundaryId(nid) === boundaryId) {
            node = n;
            break;
          }
        }
      }
      const fileId = node?.filePath || boundaryId.split(":")[0];
      const absFileId = isAbsolute(fileId) ? fileId : join(ctx.compiler.rootDir, fileId);

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
  };
}
