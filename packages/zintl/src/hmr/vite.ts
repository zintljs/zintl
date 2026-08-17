import type { ModuleNode, ViteDevServer } from "vite";
import type Context from "../context.js";
import { RESOLVED_RAW_ASSET_PREFIX, RESOLVED_VIRTUAL_PREFIX } from "../constants.js";
import type { HostUpdateApplier, HostUpdateResult } from "./applier.js";
import { classifyFile } from "./plan.js";
import type { HotUpdatePlan } from "./types.js";

/**
 * Per-event facts Vite's hook hands over that a {@link HotUpdatePlan} cannot
 * express — the live module graph for *this* environment, the modules Vite has
 * already decided are affected, and the timestamp it will rewrite import queries
 * with.
 */
export interface ViteHostContext {
  moduleGraph: any;
  modules?: ModuleNode[];
  timestamp?: number;
}

/**
 * Vite's half of the seam: turn compiler ids into `ModuleNode`s and invalidate
 * them.
 *
 * Everything here was `hooks/hmr.ts` before proposal 029, and it is deliberately
 * unchanged rather than rewritten — including the parts that are unlovely. This
 * is the code ledger L-023's whole diagnosis effort was spent on, and the point
 * of the seam was never to fix it; it was to stop it being *the only option*.
 */
export class ViteUpdateApplier implements HostUpdateApplier {
  readonly name = "vite";

  constructor(
    private readonly ctx: Context,
    private readonly server: ViteDevServer,
  ) {}

  sendFullReload(): void {
    this.server.ws.send({ type: "full-reload", path: "*" });
  }

  applyChunkInvalidation(boundaryId: string, hostContext?: unknown): void {
    const mg = (hostContext as ViteHostContext | undefined)?.moduleGraph ?? this.server.moduleGraph;
    if (!mg) return;

    /**
     * Stamp the invalidation, the same way the hot-update path does.
     *
     * This path set no timestamp at all once — so modules invalidated from here
     * carried no ordering token, and the bundler had nothing to rewrite their
     * import query with. Two of these racing produced fetches the browser could
     * apply in either order.
     *
     * `Date.now()` is a clock of Zintl's own, and ZDB §7a says so plainly. It
     * stays because there is no host event here to take a sequence from, and
     * because reusing the *previous* event's timestamp would be worse: on Vite
     * that value becomes the `?t=` query, so re-stamping with a value the
     * browser has already fetched under would leave it serving its own cache.
     */
    const seq = Date.now();
    for (const chunkId of this.ctx.compiler.getAffectedChunks(boundaryId)) {
      for (const [modId, mod] of mg.idToModuleMap) {
        if (modId.includes(chunkId) && modId.includes("virtual:zintl")) {
          mg.invalidateModule(mod);
          mod.lastHMRTimestamp = seq;
        }
      }
    }
  }

  apply(plan: HotUpdatePlan, hostContext?: unknown): HostUpdateResult {
    const host = (hostContext ?? {}) as ViteHostContext;
    const mg = host.moduleGraph ?? this.server.moduleGraph;
    const { timestamp } = host;
    const modules = host.modules ?? [];
    const { event } = plan;
    const isSource = event.kind === "source";

    const invalidated = new Set<ModuleNode>();
    const invalidate = (mod: ModuleNode) => {
      mg.invalidateModule(mod);
      if (timestamp !== undefined) {
        mod.lastHMRTimestamp = timestamp;
      }
      invalidated.add(mod);
    };

    if (plan.invalidateAllManagers) {
      for (const [id, mod] of mg.idToModuleMap) {
        if (id.includes("virtual:zintl") && id.includes("/manager/")) {
          invalidate(mod);
        }
      }
    }

    /**
     * The asset's own module is **virtual**, so Vite cannot reach it from the
     * file that changed.
     *
     * `about.txt?raw` and `about.txt?zintl-raw` are both minted under
     * `\0virtual:zintl/rawasset/<base64url of the id>` — an extension-free
     * virtual id, chosen so no host can misclassify it by extension and
     * base64 the generated JavaScript into a `data:` URI (L-009). The cost
     * lands here: a virtual module has no `file`, so `handleHotUpdate` for the
     * asset reports only the plain file module, which this method then skips as
     * the base asset. Nothing is invalidated, no timestamp changes, the browser
     * answers the import from cache, and the source text baked into that module
     * is the text from before the edit.
     *
     * Measured rather than reasoned: removing this block turns the source-asset
     * half of the `asset-hmr` contract red on Vite while the localized half
     * stays green, because only the former is served out of a baked constant
     * (ledger L-067).
     *
     * Matched by decoding the id back to a path rather than by substring, so an
     * edit to one asset cannot invalidate another's.
     */
    if (event.kind === "asset") {
      for (const [id, mod] of mg.idToModuleMap) {
        if (!id.startsWith(RESOLVED_RAW_ASSET_PREFIX + "/")) continue;
        let decoded: string;
        try {
          decoded = Buffer.from(
            id.slice(RESOLVED_RAW_ASSET_PREFIX.length + 1),
            "base64url",
          ).toString("utf8");
        } catch {
          continue;
        }
        if (decoded.split("?")[0] !== event.file) continue;

        invalidate(mod);
        // Its importers embed or re-read this value, so they have to re-run too.
        for (const importer of mod.importers ?? []) {
          invalidate(importer);
        }
      }
    }

    // 1. Invalidate modules provided by Vite
    for (const mod of modules) {
      const isBaseJson = event.kind === "json" && mod.file === event.file;
      const isBaseAsset =
        event.kind === "asset" && mod.file === event.file && !mod.id?.includes("?");
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
    for (const boundary of plan.boundaries) {
      for (const entryPath of boundary.entryFilePaths) {
        const relPath = entryPath.startsWith("/") ? entryPath : "/" + entryPath;
        for (const [id, mod] of mg.idToModuleMap) {
          const normalizedId = id.split("?")[0];
          const idNoExt = normalizedId.replace(/\.[a-z0-9]+$/i, "");
          if (
            id === relPath ||
            id === entryPath ||
            normalizedId.endsWith(entryPath) ||
            idNoExt.endsWith(entryPath)
          ) {
            invalidate(mod);
          }
        }
      }

      for (const chunkId of boundary.chunkIds) {
        for (const [id, mod] of mg.idToModuleMap) {
          if (id.includes(chunkId) && id.includes("virtual:zintl")) {
            invalidate(mod);
          }
        }
      }

      const { fileId, absFileId } = boundary;
      if (!fileId || !absFileId) continue;

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
        if (vMod) invalidate(vMod);
      }

      // Fallback scan
      const relPath = fileId.startsWith("/") ? fileId : "/" + fileId;
      const fileIdNoExt = fileId.replace(/\.[a-z0-9]+$/i, "");
      const relPathNoExt = relPath.replace(/\.[a-z0-9]+$/i, "");

      for (const [id, mod] of mg.idToModuleMap) {
        const cleanModuleId = id.replace(/\.zintl-[a-zA-Z0-9_-]+\.(vue|svelte)/, ".$1");
        const normalizedId = cleanModuleId.split("?")[0];
        const normalizedIdNoExt = normalizedId.replace(/\.[a-z0-9]+$/i, "");

        /**
         * The extension-blind comparisons below exist for one reason: a boundary
         * id can arrive here *without* an extension, because `getNormalizedId`
         * strips it (ledger L-026). They must not be allowed to match a file
         * that merely shares a basename with the boundary's source.
         *
         * `src/App.css` sitting beside `src/App.tsx` is the case that bit, and
         * it bit exactly as 027 §2.4 predicted it would: both strip to
         * `src/App`, so the stylesheet matched the component, was repointed onto
         * `App.tsx`, and went into the update list as if it were the component.
         * The measured consequence on `react-basic` was the entry re-executing
         * on roughly one edit in ten — `main.tsx` self-accepts, so re-execution
         * re-runs `bootstrap()` and `createRoot()` mounts a second root over the
         * first, which is proposal 024 §1.3's "latent React case".
         *
         * Measured rather than argued, and the measurement is why this comment
         * does not claim more than it should: fixing this halved the rate (six
         * occurrences in sixty edits, to three). The remainder comes from the
         * entry boundary's own source module being invalidated, which is
         * deliberate — `reactRuntimeFacet.entryReexecutionSafe` is what makes
         * *that* half safe. This match was never a cause worth keeping either
         * way: a stylesheet is not a boundary's source under any reading.
         *
         * So an extension-blind match now requires the *candidate* to be a file
         * Zintl would extract from at all. Asked through `classifyFile` rather
         * than a second list, so the two cannot drift. Ids with no extension
         * stay eligible — they are what these comparisons were written for.
         */
        const hasExtension = /\.[a-z0-9]+$/i.test(normalizedId);
        const extensionBlindEligible = !hasExtension || classifyFile(normalizedId) === "source";

        const isMatch =
          cleanModuleId === relPath ||
          cleanModuleId === fileId ||
          cleanModuleId.endsWith(fileId) ||
          normalizedId.endsWith(fileId) ||
          normalizedId === relPath ||
          normalizedId === fileId ||
          (extensionBlindEligible &&
            (normalizedIdNoExt === fileIdNoExt ||
              normalizedIdNoExt === relPathNoExt ||
              normalizedIdNoExt.endsWith(fileIdNoExt)));

        if (isMatch && !id.includes("virtual:zintl")) {
          if (mod.file !== absFileId) {
            /**
             * The load-bearing entry for 027 §2.4 / ledger L-023's unexamined
             * hypothesis: this repoints `mod.file` (and Vite's own
             * `fileToModulesMap`) off a loose string match, not an exact one. If
             * `absFileId` here is ever wrong for what `id` actually is, the
             * module silently stops being reachable by its real path — the next
             * genuine edit to that path hands the hook `modules: []` (see the
             * `enter` trace entry).
             *
             * That this now lives in a file named for one host is itself the
             * point of proposal 029: it is Vite's `ModuleGraph` being repaired
             * with Vite's own vocabulary, not something every host must inherit.
             */
            this.ctx.hmrTrace.push({
              ts: Date.now(),
              kind: "repoint",
              file: event.file,
              moduleId: id,
              oldFile: mod.file ?? undefined,
              newFile: absFileId,
              boundaryId: boundary.boundaryId,
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

    if (plan.fullReload) this.sendFullReload();

    return { count: invalidated.size, hostModules: Array.from(invalidated) };
  }
}
