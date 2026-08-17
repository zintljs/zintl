import { dirname, join } from "node:path";
import {
  type BoundaryGraph,
  type ChunkGraph,
  type Boundary,
  type ChunkInfo,
  type BoundaryMetadata,
  type DependencyGraph,
  type ObservedAnchor,
} from "../types/index.js";
import { type ZintlLogger } from "@zintljs/extractor";
import type { BoundaryDep } from "@zintljs/extractor";
import type { IOManager } from "./IOManager.js";
import type { CompilerContext, ContentFacet } from "../types/capabilities.js";
import type { Manifest } from "../reconcile.js";
import { compareStrings } from "../utils/serialization.js";
/**
 * Manages boundary and chunk graphs.
 */
export class GraphManager {
  public boundaryGraph: BoundaryGraph | null = null;
  public chunkGraph: ChunkGraph | null = null;

  private lastManifest: Manifest = {};
  private lastMetadata: Record<string, BoundaryMetadata> = {};
  private readonly isContentCache = new Map<string, boolean>();

  constructor(
    private readonly io: IOManager,
    private readonly isDev: boolean,
    private readonly logger: ZintlLogger,
    private readonly locales: string[] = ["en"],
  ) {}

  /**
   * Turn a dependency's *specifier* into the file id the graphs are keyed by.
   *
   * `metadata` and `manifest` default to the state of the last built boundary
   * graph, which is right for every traversal that runs as part of building it.
   * They are overridable because {@link hasTranslatableContent} is handed its
   * graphs as arguments and can be asked about a graph this manager has not
   * built — and resolving against different data than the caller then walks
   * makes the two disagree about which files exist. Found by testing it.
   */
  private resolveDependencyFileId(
    depFileId: string,
    ownerId: string,
    dependencyGraph: DependencyGraph,
    metadata: Record<string, unknown> = this.lastMetadata,
    manifest: Record<string, unknown> = this.lastManifest,
  ): string {
    let resolved = depFileId.startsWith(".") ? join(dirname(ownerId), depFileId) : depFileId;
    const clean = this.io.getNormalizedId(resolved);

    /**
     * Exact key lookups only, and that is a performance requirement rather than
     * a simplification.
     *
     * Manifest keys are `<file>:<boundary>`, so it is tempting to also match a
     * `<file>:` prefix here. Measured: scanning `Object.keys(manifest)` per
     * candidate, per extension, per dependency edge — and this runs on every
     * traversal in this file — blew the Structural HMR budget by 48% and the
     * Colony HMR budget by 23% on an otherwise-idle machine.
     *
     * It also buys nothing real. A file that carries manifest entries is keyed
     * in `metadataGraph` and `dependencyGraph` too, and both of those are exact
     * lookups; the prefix case only arises in a synthetic graph where those were
     * left out. Content discovery still prefix-matches the manifest — that is
     * `hasTranslatableContent`'s own job, done once per node rather than once
     * per candidate.
     */
    if (metadata[clean] !== undefined) return clean;
    if (manifest[clean] !== undefined) return clean;
    if (dependencyGraph[clean] !== undefined) return clean;

    for (const ext of this.io.resolvedExtensions) {
      const candidate = clean + ext;
      if (
        metadata[candidate] !== undefined ||
        manifest[candidate] !== undefined ||
        dependencyGraph[candidate] !== undefined
      ) {
        return candidate;
      }
    }
    return clean;
  }

  public buildBoundaryGraph(
    internalManifest: Manifest,
    metadataGraph: Record<string, BoundaryMetadata>,
    dependencyGraph: DependencyGraph,
    virtualBoundaries?: string[],
    contentFacets: ContentFacet[] = [],
    context?: CompilerContext,
  ): BoundaryGraph {
    this.logger.debug("Starting boundary graph construction...");
    const vbList = virtualBoundaries || (this.isDev ? ["b_assets"] : []);
    const nodes = new Map<string, Boundary>();
    const entries = new Set<string>();

    /**
     * A virtual boundary belongs in *this* graph only in dev, where the three
     * sites below synthesize it. It is not a source boundary — it owns no file,
     * and in a build its catalog reaches the output through the content facet
     * instead.
     *
     * The filter exists because the dev synthesis is **persisted**: `.zintl`'s
     * manifest keeps `manifest["b_assets"]` and `metadata["b_assets"]`, and the
     * seeding loop below reads boundary candidates straight out of those. A
     * production compile that happened to load a dev-written manifest therefore
     * grew a `b_assets` node through the ordinary loop — with `filePath` set to
     * the id and `usageCount: 0`, a shape *neither* code path intends — and one
     * that did not was identical apart from it. Which of the two you got
     * depended on whether a dev run had touched that project in the same
     * worker first, so a serialized-graph snapshot became a function of test
     * ordering rather than of the source.
     */
    const leakedVirtual = this.isDev ? new Set<string>() : new Set(vbList);

    const allKnownBoundaries = new Set<string>();
    for (const k of Object.keys(internalManifest)) {
      if (leakedVirtual.has(k)) continue;
      allKnownBoundaries.add(k);
    }
    for (const k of Object.keys(metadataGraph)) {
      const nId = k;
      if (leakedVirtual.has(nId)) continue;
      allKnownBoundaries.add(nId);
      for (const site of metadataGraph[k].anchorSites || []) {
        allKnownBoundaries.add(this.io.getNormalizedId(site.boundaryId));
      }
      for (const bId of Object.values(metadataGraph[k].exportedBoundaries || {})) {
        allKnownBoundaries.add(this.io.getNormalizedId(bId));
      }
    }

    this.logger.debug(`Found ${allKnownBoundaries.size} unique boundary candidates`);

    const normalizedMetadata: Record<string, BoundaryMetadata> = {};
    for (const [k, v] of Object.entries(metadataGraph)) {
      const nId = k;
      const existing = normalizedMetadata[nId];
      normalizedMetadata[nId] = {
        ...v,
        anchorSites: [...(existing?.anchorSites || []), ...(v.anchorSites || [])],
        exportedBoundaries: { ...existing?.exportedBoundaries, ...v.exportedBoundaries },
        internalDependencies: { ...existing?.internalDependencies, ...v.internalDependencies },
      };
    }

    const normalizedManifest: Manifest = {};
    for (const [k, v] of Object.entries(internalManifest)) {
      if (!Array.isArray(v)) continue;
      const nId = k;
      normalizedManifest[nId] = [...(normalizedManifest[nId] || []), ...v];
    }

    this.lastManifest = normalizedManifest;
    this.lastMetadata = normalizedMetadata;

    const normalizedDeps: DependencyGraph = {};
    const inverseDynamicDependencies = new Set<string>();
    for (const [ownerId, ownerDeps] of Object.entries(dependencyGraph)) {
      if (!Array.isArray(ownerDeps)) continue;
      const nOwnerId = this.io.getNormalizedId(ownerId);
      normalizedDeps[nOwnerId] = ownerDeps;
      for (const dep of ownerDeps) {
        if (!dep.dynamic) continue;
        const resolvedDepId = this.resolveDependencyFileId(dep.id, ownerId, dependencyGraph);
        inverseDynamicDependencies.add(resolvedDepId);
      }
    }

    for (const bId of allKnownBoundaries) {
      if (!bId || this.io.isVirtualId(bId)) continue;
      const normalizedBId = this.io.getNormalizedId(bId);
      const fileId = normalizedBId.split(":")[0];
      const meta = normalizedMetadata[fileId];
      const hasContent = (normalizedManifest[normalizedBId] || []).length > 0;
      const hasTopLevelA = (meta?.anchorSites || []).some((s: ObservedAnchor) => s.isTopLevel);
      const isNested = normalizedBId.includes(":");
      let isDictator = isNested
        ? !hasTopLevelA &&
          (meta?.anchorSites || []).some(
            (s) => this.io.getNormalizedId(s.boundaryId) === normalizedBId,
          )
        : hasTopLevelA || !!meta?.hasZintlMarker;

      let isContent = this.isContentCache.get(fileId);
      if (isContent === undefined) {
        isContent = context ? contentFacets.some((a) => a.match(fileId, context)) : false;
        this.isContentCache.set(fileId, isContent);
      }

      if (isContent) {
        const check = this.leadsToBoundary(fileId, dependencyGraph, metadataGraph);
        if (check.leads) {
          isDictator = true;
        }
      }

      const rawDeps = normalizedDeps[fileId] || [];

      // Skip nodes with no content, no anchor, AND no dependencies.
      // Nodes with deps are kept as "pass-through" so the graph walk can
      // traverse through intermediate files (e.g. parent modules or wrapper layout templates) to reach
      // downstream content-bearing boundaries.
      if (!isDictator && !hasContent) {
        if (isContent || rawDeps.length === 0) continue;
      }
      const resolvedDeps: BoundaryDep[] = [];
      for (const dep of rawDeps) {
        const cleanDepFileId = this.resolveDependencyFileId(dep.id, fileId, dependencyGraph);
        const depMeta = normalizedMetadata[cleanDepFileId];

        if (dep.bindings?.length && depMeta?.exportedBoundaries) {
          for (const binding of dep.bindings) {
            const resolvedBId = depMeta.exportedBoundaries[binding];
            resolvedDeps.push({
              id: this.io.getNormalizedId(resolvedBId || cleanDepFileId),
              dynamic: dep.dynamic,
              bindings: [binding],
            });
          }
        } else {
          resolvedDeps.push({
            id: cleanDepFileId,
            dynamic: dep.dynamic,
            bindings: dep.bindings || [],
          });
        }
      }

      const mode = isDictator
        ? "entry"
        : inverseDynamicDependencies.has(fileId)
          ? "lazy"
          : "boundary";
      const nestedAnchors = isNested
        ? []
        : [
            ...(meta?.anchorSites || [])
              .filter((s: ObservedAnchor) => !s.isTopLevel && s.boundaryId.includes(":"))
              .map((s: ObservedAnchor) => ({
                id: this.io.getNormalizedId(s.boundaryId),
                dynamic: false,
              })),
            ...Object.values(meta?.exportedBoundaries || {}).map((bId) => ({
              id: this.io.getNormalizedId(bId),
              dynamic: false,
            })),
          ];

      // Remove duplicates
      const uniqueNestedAnchors = Array.from(new Set(nestedAnchors.map((a) => a.id))).map((id) => ({
        id,
        dynamic: false,
      }));

      const internalDeps = (meta?.internalDependencies || {})[normalizedBId] || [];
      const resolvedInternalDeps = internalDeps.map((id: string) => ({
        id: this.io.getNormalizedId(id),
        dynamic: false,
      }));

      let activeLocales: Set<string> | "all" = new Set<string>();
      let isFannedBoundary = false;
      for (const loc of this.locales) {
        if (normalizedBId.startsWith(loc + "/") || normalizedBId === loc) {
          activeLocales = new Set<string>([loc]);
          isFannedBoundary = true;
          break;
        }
      }

      if (!isFannedBoundary) {
        if (isDictator) {
          const sites = (meta?.anchorSites || []).filter(
            (s: ObservedAnchor) => this.io.getNormalizedId(s.boundaryId) === normalizedBId,
          );
          if (sites.length === 0) {
            activeLocales = "all";
          } else {
            for (const site of sites) {
              if (!site.locale) continue;
              if (site.locale.type === "expression") {
                activeLocales = "all";
                break;
              } else if (site.locale.type === "literal") {
                if (site.locale.value === "*") {
                  activeLocales = "all";
                  break;
                }
                (activeLocales as Set<string>).add(site.locale.value);
              }
            }
          }
        } else {
          activeLocales = "all";
        }
      }

      const allDeps = [...resolvedDeps, ...uniqueNestedAnchors, ...resolvedInternalDeps];
      // In dev mode, every entry depends on virtual boundaries to ensure localized content is available
      if (mode === "entry" && this.isDev) {
        for (const vb of vbList) {
          allDeps.push({ id: vb, dynamic: false });
        }
      }

      nodes.set(normalizedBId, {
        id: normalizedBId,
        mode: mode === "entry" ? "entry" : "boundary",
        deps: allDeps,
        usageCount: 0,
        filePath: fileId,
        activeLocales,
      });

      if (mode === "entry") entries.add(normalizedBId);
    }

    // Ensure virtual boundaries exist in the graph in dev mode
    if (this.isDev) {
      for (const vb of vbList) {
        if (!nodes.has(vb)) {
          nodes.set(vb, {
            id: vb,
            mode: "boundary",
            deps: [],
            usageCount: 1,
            filePath: "virtual-content",
            activeLocales: "all",
          });
        }
      }
    }

    return { nodes, entries };
  }

  public propagateActiveLocales(graph: BoundaryGraph) {
    this.logger.debug("Propagating active locales...");
    const queue = Array.from(graph.entries);

    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = graph.nodes.get(id);
      if (!node) continue;

      const parentLocales = node.activeLocales;

      for (const dep of node.deps) {
        const child = graph.nodes.get(dep.id);
        if (!child) continue;

        let childChanged = false;
        if (parentLocales === "all") {
          if (child.activeLocales !== "all") {
            child.activeLocales = "all";
            childChanged = true;
          }
        } else {
          if (child.activeLocales !== "all") {
            for (const loc of parentLocales) {
              if (!child.activeLocales.has(loc)) {
                child.activeLocales.add(loc);
                childChanged = true;
              }
            }
          }
        }

        if (childChanged) {
          queue.push(dep.id);
        }
      }
    }
  }

  public computeTranslationChunks(
    graph: BoundaryGraph,
    internalManifest: Manifest,
    metadataGraph: Record<string, BoundaryMetadata>,
    virtualBoundaries?: string[],
  ): ChunkGraph {
    this.logger.debug("Computing translation chunks...");
    const vbList = virtualBoundaries || (this.isDev ? ["b_assets"] : []);
    const chunks = new Map<string, ChunkInfo>();
    const entryChunks = new Map<string, string>();
    const lazyChunks = new Set<string>();
    const sharedChunks = new Set<string>();
    const boundaryToOwner = new Map<string, string>();

    const entryPoints = this.getChunkRoots(graph, internalManifest, metadataGraph);
    this.logger.debug(`Found ${entryPoints.size} entry points (roots)`);
    const entryStaticTrees = new Map<string, Set<string>>();
    const usageCounts = new Map<string, number>();

    const entryFullTrees = new Map<string, Set<string>>();
    for (const entryId of entryPoints) {
      const staticTree = new Set<string>();
      const fullTree = new Set<string>();

      const walk = (id: string, isStatic: boolean) => {
        if (isStatic) {
          if (staticTree.has(id)) return;
          staticTree.add(id);
          usageCounts.set(id, (usageCounts.get(id) || 0) + 1);
        } else {
          if (fullTree.has(id)) return;
          fullTree.add(id);
        }

        const node = graph.nodes.get(id);
        if (!node) return;

        for (const dep of node.deps) {
          if (entryPoints.has(dep.id)) {
            if (isStatic) continue;
            const depNode = graph.nodes.get(dep.id);
            if (depNode?.mode === "entry") continue;
          }

          if (isStatic && !dep.dynamic) {
            walk(dep.id, true);
          } else {
            walk(dep.id, false);
          }
        }
      };

      walk(entryId, true);
      // Re-run walk starting from the static tree nodes to find all dynamic reachables
      for (const id of Array.from(staticTree)) {
        walk(id, false);
      }

      entryStaticTrees.set(entryId, staticTree);
      entryFullTrees.set(entryId, fullTree);
    }

    const sharedBoundaries = new Set<string>();
    for (const [id, count] of usageCounts.entries()) {
      if (count > 1 && !entryPoints.has(id) && !vbList.includes(id)) {
        sharedBoundaries.add(this.io.getNormalizedId(id));
        const chunkId = `shared_${this.io.getSafeBoundaryId(id)}`;
        chunks.set(chunkId, {
          id: chunkId,
          type: "shared",
          boundaries: new Set([id]),
          colonies: new Set(),
          entrySources: new Set(),
        });
        sharedChunks.add(chunkId);
      }
    }
    this.logger.debug(`Found ${sharedBoundaries.size} shared boundaries`);

    // 1. All entry points (roots) own themselves
    for (const entryId of entryPoints) {
      const normEntry = this.io.getNormalizedId(entryId);
      boundaryToOwner.set(normEntry, normEntry);
    }

    // 2. Assign ownership to boundaries based on static reachability
    for (const entryId of entryPoints) {
      const tree = this.getStaticDependencyTree(entryId, graph);
      for (const id of tree) {
        const nId = this.io.getNormalizedId(id);
        if (!boundaryToOwner.has(nId)) {
          boundaryToOwner.set(nId, this.io.getNormalizedId(entryId));
        }
      }
    }

    for (const entryId of entryPoints) {
      const staticTree = entryStaticTrees.get(entryId)!;
      const finalBoundaries = new Set<string>();
      for (const id of staticTree) {
        if (!sharedBoundaries.has(this.io.getNormalizedId(id)) || id === entryId) {
          finalBoundaries.add(id);
        }
      }

      const fullTree = entryFullTrees.get(entryId)!;
      const colonies = new Set<string>();
      for (const id of fullTree) {
        if (!staticTree.has(id) && !sharedBoundaries.has(this.io.getNormalizedId(id))) {
          colonies.add(id);
        }
      }

      const isExplicit = graph.entries.has(entryId);
      const type = isExplicit ? "entry" : "lazy";
      const chunkId = `${type}_${this.io.getSafeBoundaryId(entryId)}`;
      chunks.set(chunkId, {
        id: chunkId,
        type,
        boundaries: finalBoundaries,
        colonies,
        entrySources: new Set([entryId]),
      });
      if (isExplicit) entryChunks.set(entryId, chunkId);
      else lazyChunks.add(chunkId);
    }

    return {
      chunks,
      entryChunks,
      lazyChunks,
      sharedChunks,
      boundaryToOwner,
    };
  }

  public computeUsageCounts(graph: BoundaryGraph): Map<string, number> {
    const counts = new Map<string, number>();
    const entries = this.getChunkRoots(graph, this.lastManifest, this.lastMetadata);
    for (const entryId of entries) {
      const visited = new Set<string>();
      const walk = (id: string) => {
        if (visited.has(id)) return;
        const node = graph.nodes.get(id);
        if (!node) return;
        visited.add(id);
        counts.set(id, (counts.get(id) || 0) + 1);
        for (const dep of node.deps) if (!dep.dynamic && !entries.has(dep.id)) walk(dep.id);
      };
      walk(entryId);
    }
    return counts;
  }

  private getChunkRoots(
    graph: BoundaryGraph,
    internalManifest: Manifest,
    metadataGraph: Record<string, BoundaryMetadata>,
  ): Set<string> {
    const roots = new Set<string>();
    const staticParents = new Set<string>();
    for (const node of graph.nodes.values()) {
      for (const dep of node.deps) {
        if (!dep.dynamic) {
          staticParents.add(this.io.getNormalizedId(dep.id));
        }
      }
    }

    for (const bId of graph.entries) {
      const fileId = bId.split(":")[0];
      const meta = metadataGraph[fileId];
      const isDictator =
        (meta?.anchorSites || []).some((s) => s.isTopLevel) ||
        bId.includes(":") ||
        meta?.hasZintlMarker;
      const hasContent = (internalManifest[bId]?.length || 0) > 0;

      const isFileLevelEntry = !bId.includes(":") && (meta?.isEntry || meta?.hasZintlMarker);

      if (isDictator || isFileLevelEntry) {
        roots.add(bId);
      } else {
        const normalizedBId = this.io.getNormalizedId(bId);
        if (!staticParents.has(normalizedBId) && hasContent && bId.includes(":")) {
          roots.add(bId);
        }
      }
    }
    for (const node of graph.nodes.values())
      for (const dep of node.deps) if (dep.dynamic) roots.add(dep.id);

    /**
     * Sorted, because callers resolve ties by *first writer wins* over this set.
     *
     * `computeTranslationChunks` assigns ownership by walking each root's static
     * tree and keeping whichever root reached a boundary first, so the iteration
     * order of this set decides who owns anything reachable from two roots. The
     * order came from `graph.entries` and `graph.nodes`, which are populated in
     * discovery order — and discovery order differs between a compiler starting
     * cold and one reading a saved manifest, because the manifest is written
     * with sorted keys.
     *
     * The observable effect was that the same source produced two different
     * graphs. In `react-basic`, `src/App.tsx:App` was owned by
     * `src/main.tsx:bootstrap` when a manifest existed and by an anonymous
     * `src/main.tsx:f_547` when one did not — the file has two nested anchors
     * (`bootstrap` and an arrow function), both of which statically reach `App`.
     *
     * ZRS Axiom 4 already requires exactly this: ownership resolves by
     * lexicographic order so builds are reproducible "regardless of file system
     * enumeration order". The rule was written down and never applied here.
     */
    return new Set([...roots].sort(compareStrings));
  }

  public getStaticDependencyTree(entryId: string, graph: BoundaryGraph): Set<string> {
    const tree = new Set<string>();
    const walk = (id: string) => {
      if (tree.has(id)) return;
      const node = graph.nodes.get(id);
      if (!node) return;
      tree.add(id);
      for (const dep of node.deps) if (!dep.dynamic) walk(dep.id);
    };
    walk(entryId);
    return tree;
  }

  public isLiveOwner(ownerId: string, internalManifest: Manifest): boolean {
    if (!this.boundaryGraph || !this.chunkGraph) return false;
    let cleanId = ownerId.includes(":") ? ownerId.substring(ownerId.indexOf(":") + 1) : ownerId;
    try {
      cleanId = decodeURIComponent(cleanId);
    } catch {}

    const pathId = Array.from(this.boundaryGraph.nodes.keys()).find(
      (b) => this.io.getSafeBoundaryId(b) === cleanId,
    );
    if (!pathId || !this.chunkGraph.boundaryToOwner.has(pathId)) return false;

    const resolvedOwnerId = this.chunkGraph.boundaryToOwner.get(pathId)!;
    for (const chunk of this.chunkGraph.chunks.values()) {
      for (const bId of chunk.boundaries) {
        if (this.chunkGraph.boundaryToOwner.get(bId) === resolvedOwnerId) {
          if ((internalManifest[bId]?.length || 0) > 0) return true;
        }
      }
    }
    return false;
  }

  /**
   * Does this file, or anything it transitively imports, carry translatable
   * content?
   *
   * The question a bundler integration actually needs when it is deciding
   * whether to propagate a locale across an import edge: a module with nothing
   * to translate does not need a per-locale copy. Its negation is
   * "translation-neutral".
   *
   * **This is not {@link leadsToBoundary}, and the two are not interchangeable**
   * even though they read as if they were. `leadsToBoundary` asks whether a file
   * reaches a *trust anchor*, which is a question about locale ownership; this
   * one asks whether a file reaches *content*, which is a question about
   * payload. A plain component holding strings but declaring no anchor answers
   * `false` to the first and `true` to this — and it is by far the common case,
   * so answering the wrong one silently drops that component's translations.
   *
   * `isAssetLike` is injected because assets belong to a content facet, and this
   * manager has no business knowing which extensions that facet claims.
   */
  public hasTranslatableContent(
    fileId: string,
    dependencyGraph: DependencyGraph,
    metadataGraph: Record<string, BoundaryMetadata>,
    internalManifest: Manifest,
    isAssetLike: (cleanFileId: string) => boolean,
    visited = new Set<string>(),
  ): boolean {
    if (typeof fileId !== "string" || visited.has(fileId)) return false;
    visited.add(fileId);

    const cleanFileId = fileId.split("?")[0];

    if (isAssetLike(cleanFileId)) return true;

    const meta = metadataGraph[cleanFileId];
    if (meta) {
      const hasOwnContent =
        meta.hasZintlMarker ||
        meta.hasZintlMacro ||
        (meta.anchorSites && meta.anchorSites.length > 0) ||
        meta.needsLoader;
      if (hasOwnContent) return true;
    }

    for (const key of Object.keys(internalManifest)) {
      if (key === cleanFileId || key.startsWith(cleanFileId + ":")) {
        const msgs = internalManifest[key];
        if (msgs && msgs.length > 0) return true;
      }
    }

    const deps = dependencyGraph[cleanFileId];
    if (deps) {
      for (const dep of deps) {
        const depId = typeof dep === "string" ? dep : dep?.id;
        if (!depId) continue;
        /**
         * `resolveDependencyFileId`, like every other traversal in this file.
         *
         * When this walk was first moved out of the Vite plugin it kept the
         * plugin's own resolution — `getNormalizedId(join(dirname(owner), dep))`
         * — so that the move was provably behaviour-neutral. That spelling has a
         * hole: an extensionless import (`./counter`) resolves to `src/counter`,
         * which is a key in no graph, so the walk stopped there and reported the
         * importer translation-neutral.
         *
         * Neutral means "needs no per-locale copy", so the failure direction was
         * the dangerous one: a module that *does* reach translatable content,
         * skipped. `resolveDependencyFileId` closes it by trying each known
         * extension — which is why every other traversal here already used it.
         */
        const nDepId = this.resolveDependencyFileId(
          depId,
          cleanFileId,
          dependencyGraph,
          metadataGraph,
          internalManifest,
        );
        if (
          this.hasTranslatableContent(
            nDepId,
            dependencyGraph,
            metadataGraph,
            internalManifest,
            isAssetLike,
            visited,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  public leadsToBoundary(
    fileId: string,
    dependencyGraph: DependencyGraph,
    metadataGraph: Record<string, BoundaryMetadata>,
    visited = new Set<string>(),
  ): { leads: boolean; dynamic: boolean; bakedLocale?: string } {
    if (visited.has(fileId)) return { leads: false, dynamic: false };
    visited.add(fileId);

    const deps = dependencyGraph[fileId] || [];
    let result = { leads: false, dynamic: false, bakedLocale: undefined as string | undefined };

    // 0. Is the current file itself a trust anchor (or contains one)?
    const meta = metadataGraph[fileId];
    if (meta && (meta.anchorSites.length > 0 || meta.hasZintlMarker)) {
      result.leads = true;
      const anchors = meta.anchorSites;
      for (const a of anchors) {
        const isContextual =
          a.locale.type === "none" ||
          (a.locale.type === "expression" && !a.locale.source) ||
          (a.locale.type === "literal" && a.locale.value === "none");
        const isSovereign = a.locale.type === "literal" && a.locale.value === "*";

        if (isContextual) {
          // Contextual anchor is inherited/baked statically
        } else if (isSovereign) {
          // Sovereign anchor is fanned/baked statically
          if (!result.bakedLocale) {
            result.bakedLocale = "*";
          }
        } else if (a.locale.type === "expression") {
          result.dynamic = true;
        } else if (a.locale.type === "literal" && !result.bakedLocale) {
          result.bakedLocale = a.locale.value;
        }
      }
    }

    for (const dep of deps) {
      const nDepId = this.resolveDependencyFileId(dep.id, fileId, dependencyGraph);

      // 1. Recurse
      const depResult = this.leadsToBoundary(nDepId, dependencyGraph, metadataGraph, visited);

      if (depResult.leads) {
        result.leads = true;
        if (depResult.dynamic) result.dynamic = true;
        if (depResult.bakedLocale && !result.bakedLocale)
          result.bakedLocale = depResult.bakedLocale;
      }

      // If we found a dynamic anchor, we can stop early if we only care about dynamicism,
      // but we might need to continue to find ALL reachable boundaries for other reasons.
      // However, for leadsToBoundary, once result.leads and result.dynamic are true, we are mostly done.
    }

    return result;
  }
}
