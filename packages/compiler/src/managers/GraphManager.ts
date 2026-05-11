import { dirname, join } from "node:path";
import {
  type BoundaryGraph,
  type ChunkGraph,
  type Boundary,
  type ChunkInfo,
  type BoundaryMetadata,
  type ObservedDependency,
  type ObservedAnchor,
} from "../types/index.js";
import { type ZintlLogger } from "@zintl/extractor";
import type { IOManager } from "./IOManager.js";

/**
 * Manages boundary and chunk graphs.
 */
export class GraphManager {
  public boundaryGraph: BoundaryGraph | null = null;
  public chunkGraph: ChunkGraph | null = null;

  private lastManifest: Record<string, any[]> = {};
  private lastMetadata: Record<string, BoundaryMetadata> = {};

  constructor(
    private readonly io: IOManager,
    _root: string,
    _isDev: boolean,
    private readonly logger: ZintlLogger,
    private readonly locales: string[] = ["en"],
  ) {}

  public buildBoundaryGraph(
    internalManifest: Record<string, any[]>,
    metadataGraph: Record<string, BoundaryMetadata>,
    dependencyGraph: Record<string, ObservedDependency[]>,
  ): BoundaryGraph {
    this.logger.debug("Starting boundary graph construction...");
    const nodes = new Map<string, Boundary>();
    const entries = new Set<string>();

    const allKnownBoundaries = new Set<string>();
    for (const k of Object.keys(internalManifest)) allKnownBoundaries.add(k);
    for (const k of Object.keys(metadataGraph)) {
      const nId = k;
      allKnownBoundaries.add(nId);
      for (const site of metadataGraph[k].anchorSites || []) {
        allKnownBoundaries.add(this.io.getNormalizedId(site.boundaryId));
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

    const normalizedManifest: Record<string, any[]> = {};
    for (const [k, v] of Object.entries(internalManifest)) {
      if (!Array.isArray(v)) continue;
      const nId = k;
      normalizedManifest[nId] = [...(normalizedManifest[nId] || []), ...v];
    }

    this.lastManifest = normalizedManifest;
    this.lastMetadata = normalizedMetadata;

    const normalizedDeps: Record<string, any[]> = {};
    const inverseDynamicDependencies = new Set<string>();
    for (const [ownerId, ownerDeps] of Object.entries(dependencyGraph)) {
      if (!Array.isArray(ownerDeps)) continue;
      const nOwnerId = this.io.getNormalizedId(ownerId);
      normalizedDeps[nOwnerId] = ownerDeps;
      for (const dep of ownerDeps) {
        if (!dep.dynamic) continue;
        let depId = dep.id;
        if (depId.startsWith(".")) depId = join(dirname(ownerId), depId);
        inverseDynamicDependencies.add(this.io.getNormalizedId(depId));
      }
    }

    for (const bId of allKnownBoundaries) {
      if (!bId || bId.includes("\0")) continue;
      const normalizedBId = this.io.getNormalizedId(bId);
      const fileId = normalizedBId.split(":")[0];
      const meta = normalizedMetadata[fileId];
      const hasContent = (normalizedManifest[normalizedBId] || []).length > 0;
      const hasTopLevelA = (meta?.anchorSites || []).some((s: ObservedAnchor) => s.isTopLevel);
      const isNested = normalizedBId.includes(":");
      let isDictator = isNested
        ? !hasTopLevelA &&
          (meta?.anchorSites || []).some(
            (s) => this.io.getNormalizedId(s.boundaryId) === normalizedBId && !s.isTopLevel,
          )
        : hasTopLevelA || !!meta?.hasZintlMarker;

      if (fileId.endsWith(".html") && meta?.htmlProjection) {
        const check = this.leadsToBoundary(fileId, dependencyGraph, metadataGraph);
        if (check.leads) {
          isDictator = true;
        }
      }

      if (!isDictator && !hasContent) continue;

      const rawDeps = normalizedDeps[fileId] || [];
      const resolvedDeps: any[] = [];
      for (const dep of rawDeps) {
        let depFileId = dep.id.startsWith(".") ? join(dirname(fileId), dep.id) : dep.id;
        const cleanDepFileId = this.io.getNormalizedId(depFileId);
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

      nodes.set(normalizedBId, {
        id: normalizedBId,
        mode: (mode === "entry" ? "entry" : "boundary") as any,
        deps: [...resolvedDeps, ...uniqueNestedAnchors, ...resolvedInternalDeps],
        usageCount: 0,
        filePath: fileId,
        activeLocales,
      });

      if (mode === "entry") entries.add(normalizedBId);
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
    internalManifest: Record<string, any[]>,
    metadataGraph: Record<string, BoundaryMetadata>,
  ): ChunkGraph {
    this.logger.debug("Computing translation chunks...");
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
      if (count > 1 && !entryPoints.has(id)) {
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
    internalManifest: Record<string, any[]>,
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
        (meta?.anchorSites || []).some((s: any) => s.isTopLevel) ||
        bId.includes(":") ||
        meta?.hasZintlMarker;
      const hasContent = (internalManifest[bId]?.length || 0) > 0;

      if (isDictator || meta?.isEntry || meta?.hasZintlMarker) {
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
    return roots;
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

  public isLiveOwner(ownerId: string, internalManifest: Record<string, any[]>): boolean {
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

  public leadsToBoundary(
    fileId: string,
    dependencyGraph: Record<string, ObservedDependency[]>,
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
          (a.locale as any).type === "none" ||
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
      const depFileId = dep.id.startsWith(".") ? join(dirname(fileId), dep.id) : dep.id;
      const nDepId = this.io.getNormalizedId(depFileId);

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
