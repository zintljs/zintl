import type { HmrContext, ModuleNode } from "vite";
import { isAbsolute, join } from "node:path";
import type { ZintlPluginContext } from "../context.js";
import { RESOLVED_VIRTUAL_PREFIX } from "../constants.js";

export function handleHotUpdateHook(ctx: ZintlPluginContext) {
  return async function ({ file, server, modules }: HmrContext) {
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (ctx.compiler.isWritingFile(file)) return;

    const isSource = /\.(ts|tsx|js|jsx|html)$/.test(file);
    const isJson = file.endsWith(".json");
    const isAsset = file.endsWith(".md") || file.endsWith(".txt");

    if (!isJson && !isSource && !isAsset) return;

    vLogger.debug(`HMR triggered for ${file}`);
    const invalidatedModules = new Set<ModuleNode>();
    let invalidatedBoundaries: string[] = [];

    if (isJson || isAsset) {
      if (isAsset) {
        await ctx.compiler.assets.registerAsset(file);
      }
      const inv = await ctx.compiler.invalidateFile(file, true);
      for (const b of inv) invalidatedBoundaries.push(b);

      if (inv.length === 0 && isJson) {
        for (const [id, mod] of server.moduleGraph.idToModuleMap) {
          if (id.includes("virtual:zintl") && id.includes("/manager/")) {
            invalidatedModules.add(mod);
          }
        }
      }
    } else {
      const inv = await ctx.compiler.invalidateFile(file);
      for (const b of inv) invalidatedBoundaries.push(b);
    }

    ctx.compiler.flush().catch((e) => vLogger.error(`Background flush failed: ${String(e)}`));

    // 1. Invalidate modules provided by Vite
    for (const mod of modules) {
      const isBaseJson = isJson && mod.file === file;
      const isBaseAsset = isAsset && mod.file === file && !mod.id?.includes("?");
      if (isBaseJson || isBaseAsset) continue;

      server.moduleGraph.invalidateModule(mod);
      invalidatedModules.add(mod);

      if (mod.importers) {
        for (const importer of mod.importers) {
          if (importer.id && !importer.id.includes("node_modules")) {
            server.moduleGraph.invalidateModule(importer);
            invalidatedModules.add(importer);
          }
        }
      }
    }

    // 2. Invalidate affected boundaries
    const boundaryIds = new Set(invalidatedBoundaries);
    if (isSource) boundaryIds.add(ctx.compiler.getNormalizedId(file));

    const mg = server.moduleGraph;

    for (const boundaryId of boundaryIds) {
      if (boundaryId === "b_assets" && ctx.compiler.graph.boundaryGraph) {
        for (const [_nid, n] of ctx.compiler.graph.boundaryGraph.nodes.entries()) {
          if (n.mode === "entry" && n.filePath && n.filePath !== "assets") {
            const relPath = n.filePath.startsWith("/") ? n.filePath : "/" + n.filePath;
            for (const [id, mod] of mg.idToModuleMap) {
              const normalizedId = id.split("?")[0];
              const idNoExt = normalizedId.replace(/\.[a-z0-9]+$/i, "");
              if (
                id === relPath ||
                id === n.filePath ||
                normalizedId.endsWith(n.filePath) ||
                idNoExt.endsWith(n.filePath)
              ) {
                mg.invalidateModule(mod);
                invalidatedModules.add(mod);
              }
            }
          }
        }
      }

      const affectedChunkIds = ctx.compiler.getAffectedChunks(boundaryId);
      for (const chunkModuleId of affectedChunkIds) {
        for (const [id, mod] of mg.idToModuleMap) {
          if (id.includes(chunkModuleId) && id.includes("virtual:zintl")) {
            mg.invalidateModule(mod);
            invalidatedModules.add(mod);
          }
        }
      }

      let node = ctx.compiler.graph.boundaryGraph?.nodes.get(boundaryId);
      if (!node) {
        for (const [_nid, n] of ctx.compiler.graph.boundaryGraph?.nodes.entries() || []) {
          if (ctx.compiler.io.getSafeBoundaryId(_nid) === boundaryId) {
            node = n;
            break;
          }
        }
      }

      const fileId =
        node?.filePath || (boundaryId.includes(":") ? boundaryId.split(":")[0] : boundaryId);
      if (fileId && fileId !== "assets" && !fileId.includes("\0")) {
        const absFileId = isAbsolute(fileId) ? fileId : join(ctx.compiler.rootDir, fileId);

        if (typeof mg.getModulesByFile === "function") {
          const sourceMods = mg.getModulesByFile(absFileId);
          if (
            sourceMods &&
            (sourceMods instanceof Set
              ? sourceMods.size > 0
              : Array.isArray(sourceMods) && (sourceMods as any[]).length > 0)
          ) {
            for (const mod of sourceMods as Iterable<ModuleNode>) {
              mg.invalidateModule(mod);
              invalidatedModules.add(mod);
            }
          }
        }

        const virtualId = `${RESOLVED_VIRTUAL_PREFIX}:${fileId}`;
        if (typeof mg.getModuleById === "function") {
          const vMod = mg.getModuleById(virtualId);
          if (vMod) {
            mg.invalidateModule(vMod);
            invalidatedModules.add(vMod);
          }
        }

        // Fallback scan
        const relPath = fileId.startsWith("/") ? fileId : "/" + fileId;
        const fileIdNoExt = fileId.replace(/\.[a-z0-9]+$/i, "");
        const relPathNoExt = relPath.replace(/\.[a-z0-9]+$/i, "");

        for (const [id, mod] of mg.idToModuleMap) {
          const normalizedId = id.split("?")[0];
          const normalizedIdNoExt = normalizedId.replace(/\.[a-z0-9]+$/i, "");

          const isMatch =
            id === relPath ||
            id === fileId ||
            id.endsWith(fileId) ||
            normalizedId.endsWith(fileId) ||
            normalizedId === relPath ||
            normalizedId === fileId ||
            normalizedIdNoExt === fileIdNoExt ||
            normalizedIdNoExt === relPathNoExt ||
            normalizedIdNoExt.endsWith(fileIdNoExt);

          if (isMatch && !id.includes("virtual:zintl")) {
            mg.invalidateModule(mod);
            invalidatedModules.add(mod);
          }
        }
      }

      if (boundaryId.endsWith(".html")) {
        server.ws.send({ type: "full-reload", path: "*" });
      }
    }

    if (invalidatedModules.size > 0) {
      return Array.from(invalidatedModules);
    }

    return modules;
  };
}
