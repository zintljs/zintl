import type { ModuleNode } from "vite";
import { isAbsolute, join } from "node:path";
import type Context from "../context.js";
import type { AssetManager } from "@zintljs/compiler/facets";
import { RESOLVED_VIRTUAL_PREFIX } from "../constants.js";

export function handleHotUpdateHook(ctx: Context) {
  return async function (this: any, { file, server, modules, timestamp, read }: any) {
    const vLogger = ctx.compiler._logger.withPrefix("Vite");
    if (ctx.compiler.isWritingFile(file)) {
      ctx.hmrTrace.push({ ts: Date.now(), kind: "skip-writing", file });
      return;
    }

    const isSource = /\.(ts|tsx|js|jsx|html|vue|svelte)$/.test(file);
    const isJson = file.endsWith(".json");
    const isAsset = file.endsWith(".md") || file.endsWith(".txt");

    if (!isJson && !isSource && !isAsset) {
      ctx.hmrTrace.push({ ts: Date.now(), kind: "skip-ineligible", file });
      return;
    }

    /**
     * The sequence for this event, and the content it describes.
     *
     * `timestamp` is the bundler's own hot-update clock: strictly monotonic,
     * never repeating, and already travelling to the browser as `?t=` on
     * rewritten imports. Using it means the compiler and the browser order the
     * same event by the same number.
     *
     * `read()` hands back the content the bundler saw for *this* event. Letting
     * the compiler read the file itself instead is how a later write became a
     * no-op — the watcher is unqueued, so two rapid changes run concurrently and
     * both would read whatever happened to be on disk at that moment.
     */
    const seq = typeof timestamp === "number" ? timestamp : Date.now();
    let content: string | undefined;
    if (isSource && typeof read === "function") {
      try {
        content = await read();
      } catch {
        // Fall back to a disk read inside the compiler — a file that cannot be
        // read here is usually one being rewritten, and the retry costs nothing.
      }
    }

    ctx.hmrTrace.push({
      ts: Date.now(),
      kind: "enter",
      file,
      seq,
      modulesLength: modules.length,
    });
    const invalidatedModules = new Set<ModuleNode>();
    let invalidatedBoundaries: string[] = [];

    const mg = this && this.environment ? this.environment.moduleGraph : server.moduleGraph;
    const invalidate = (mod: ModuleNode) => {
      mg.invalidateModule(mod);
      if (timestamp !== undefined) {
        mod.lastHMRTimestamp = timestamp;
      }
      invalidatedModules.add(mod);
    };

    if (isJson || isAsset) {
      if (isAsset) {
        await (ctx.compiler.assets as AssetManager).registerAsset(file);
      }
      const inv = await ctx.compiler.invalidateForUpdate(file, seq, true);
      for (const b of inv) invalidatedBoundaries.push(b);

      if (inv.length === 0 && isJson) {
        for (const [id, mod] of mg.idToModuleMap) {
          if (id.includes("virtual:zintl") && id.includes("/manager/")) {
            invalidate(mod);
          }
        }
      }
    } else {
      const inv = await ctx.compiler.invalidateForUpdate(file, seq, false, content);
      for (const b of inv) invalidatedBoundaries.push(b);
    }

    ctx.compiler.flush().catch((e) => vLogger.error(`Background flush failed: ${String(e)}`));

    // 1. Invalidate modules provided by Vite
    for (const mod of modules) {
      const isBaseJson = isJson && mod.file === file;
      const isBaseAsset = isAsset && mod.file === file && !mod.id?.includes("?");
      if (isBaseJson || isBaseAsset) continue;

      invalidate(mod);

      if (!isSource && mod.importers) {
        for (const importer of mod.importers) {
          if (importer.id && !importer.id.includes("node_modules")) {
            invalidate(importer);
          }
        }
      }
    }

    // 2. Invalidate affected boundaries
    const boundaryIds = new Set(invalidatedBoundaries);
    if (isSource) boundaryIds.add(ctx.compiler.getNormalizedId(file));

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
                invalidate(mod);
              }
            }
          }
        }
      }

      const affectedChunkIds = ctx.compiler.getAffectedChunks(boundaryId);
      for (const chunkModuleId of affectedChunkIds) {
        for (const [id, mod] of mg.idToModuleMap) {
          if (id.includes(chunkModuleId) && id.includes("virtual:zintl")) {
            invalidate(mod);
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
              invalidate(mod);
            }
          }
        }

        const virtualId = `${RESOLVED_VIRTUAL_PREFIX}:${fileId}`;
        if (typeof mg.getModuleById === "function") {
          const vMod = mg.getModuleById(virtualId);
          if (vMod) {
            invalidate(vMod);
          }
        }

        // Fallback scan
        const relPath = fileId.startsWith("/") ? fileId : "/" + fileId;
        const fileIdNoExt = fileId.replace(/\.[a-z0-9]+$/i, "");
        const relPathNoExt = relPath.replace(/\.[a-z0-9]+$/i, "");

        for (const [id, mod] of mg.idToModuleMap) {
          const cleanModuleId = id.replace(/\.zintl-[a-zA-Z0-9_-]+\.(vue|svelte)/, ".$1");
          const normalizedId = cleanModuleId.split("?")[0];
          const normalizedIdNoExt = normalizedId.replace(/\.[a-z0-9]+$/i, "");

          const isMatch =
            cleanModuleId === relPath ||
            cleanModuleId === fileId ||
            cleanModuleId.endsWith(fileId) ||
            normalizedId.endsWith(fileId) ||
            normalizedId === relPath ||
            normalizedId === fileId ||
            normalizedIdNoExt === fileIdNoExt ||
            normalizedIdNoExt === relPathNoExt ||
            normalizedIdNoExt.endsWith(fileIdNoExt);

          if (isMatch && !id.includes("virtual:zintl")) {
            const absFileId = isAbsolute(fileId) ? fileId : join(ctx.compiler.rootDir, fileId);
            if (mod.file !== absFileId) {
              /**
               * The load-bearing entry for §2.4 / ledger L-022's unexamined
               * hypothesis: this repoints `mod.file` (and Vite's own
               * `fileToModulesMap`) off a loose string match, not an exact
               * one. If `absFileId` here is ever wrong for what `id` actually
               * is, the module silently stops being reachable by its real
               * path — the next genuine edit to that path hands this hook
               * `modules: []` (see the `enter` trace entry above).
               */
              ctx.hmrTrace.push({
                ts: Date.now(),
                kind: "repoint",
                file,
                moduleId: id,
                oldFile: mod.file ?? undefined,
                newFile: absFileId,
                boundaryId,
                fileId,
              });
              if (mg.fileToModulesMap) {
                const map = mg.fileToModulesMap;
                const hasGet = typeof map.get === "function";
                const hasSet = typeof map.set === "function";

                if (mod.file) {
                  if (hasGet) {
                    const oldSet = map.get(mod.file);
                    if (oldSet) oldSet.delete(mod);
                  } else {
                    const oldSet = (map as any)[mod.file];
                    if (oldSet) oldSet.delete(mod);
                  }
                }

                if (hasGet && hasSet) {
                  let set = map.get(absFileId);
                  if (!set) {
                    set = new Set();
                    map.set(absFileId, set);
                  }
                  set.add(mod);
                } else if (!hasGet && !hasSet) {
                  let set = (map as any)[absFileId];
                  if (!set) {
                    set = new Set();
                    (map as any)[absFileId] = set;
                  }
                  set.add(mod);
                }
              }
              mod.file = absFileId;
            }
            invalidate(mod);
          }
        }
      }

      if (boundaryId.endsWith(".html")) {
        server.ws.send({ type: "full-reload", path: "*" });
      }
    }

    let hasServerOnlyUpdate = false;
    for (const boundaryId of boundaryIds) {
      const isSsr = ctx.compiler.ssrBoundaries?.has(boundaryId);
      const isClient = ctx.compiler.clientBoundaries?.has(boundaryId);
      if (isSsr && !isClient) {
        hasServerOnlyUpdate = true;
        break;
      }
    }

    if (hasServerOnlyUpdate) {
      vLogger.debug("Server-only boundary update detected, triggering full-reload");
      server.ws.send({ type: "full-reload", path: "*" });
    }

    if (invalidatedModules.size > 0) {
      ctx.hmrTrace.push({
        ts: Date.now(),
        kind: "return",
        file,
        invalidatedCount: invalidatedModules.size,
        modulesLength: modules.length,
        passthrough: false,
      });
      return Array.from(invalidatedModules);
    }

    ctx.hmrTrace.push({
      ts: Date.now(),
      kind: "return",
      file,
      invalidatedCount: 0,
      modulesLength: modules.length,
      passthrough: true,
    });
    return modules;
  };
}
