import { calculateSafeBoundaryId, calculateBoundaryId } from "../utils/hashing.js";
import type {
  WorldState,
  ObservedSink,
  ObservedAnchor,
  FileObservation,
  VariableBinding,
} from "../types/index.js";

/**
 * Resolve a boundary ID to its owning Autonomous Root ID.
 */
export function resolveOwner(
  boundaryId: string,
  worldState: WorldState,
  parentId?: string,
): string {
  const { config, chunkGraph } = worldState;

  let normalizedId = boundaryId;
  if (normalizedId.startsWith(".")) {
    const dir =
      parentId && parentId.includes("/") ? parentId.substring(0, parentId.lastIndexOf("/")) : "";
    normalizedId = dir
      ? `${dir}/${normalizedId.replace(/^\.\//, "")}`
      : normalizedId.replace(/^\.\//, "");
    while (normalizedId.includes("/../")) {
      normalizedId = normalizedId.replace(/[^/]+\/\.\.\//, "");
    }
  }

  const relativeId = normalizedId.startsWith(config.root)
    ? normalizedId.substring(config.root.length).replace(/^\/+/, "")
    : normalizedId;
  const normId = relativeId.replace(/\.(?:ts|tsx|js|jsx)$/, "").replace(/^\/+/, "");

  const owner = chunkGraph.boundaryToOwner.get(normId);
  if (owner) return owner;

  let currentId = normId;
  while (currentId.includes(":")) {
    currentId = currentId.substring(0, currentId.lastIndexOf(":"));
    const parentOwner = chunkGraph.boundaryToOwner.get(currentId);
    if (parentOwner) return parentOwner;
  }

  return normId;
}

/**
 * Resolve a boundary ID to its owning Kingdom (anchor site).
 * Unlike resolveOwner (which focuses on storage/chunking), this focuses on
 * hydration governance/lifecycle.
 */
export function resolveKingdom(boundaryId: string, worldState: WorldState): string {
  const { config, metadataGraph } = worldState;
  const relativeId = boundaryId.startsWith(config.root)
    ? boundaryId.substring(config.root.length).replace(/^\/+/, "")
    : boundaryId;
  const normId = relativeId.replace(/\.(?:ts|tsx|js|jsx)$/, "");

  const isKingdom = (b: string) => {
    const fId = b.split(":")[0];
    const m = metadataGraph[fId];
    if (!m) return false;
    // A file with zintl-marker is a Kingdom (Axiom 5)
    if (m.hasZintlMarker && !b.includes(":")) return true;
    // A function with a zintl() call is a Kingdom (Axiom 5)
    return (m.anchorSites || []).some((s: any) => {
      const sId = s.boundaryId.replace(/\.[^/.]+$/, "");
      return sId === b;
    });
  };

  if (isKingdom(normId)) return normId;

  // 1. Walk up function scope in the same file
  let currentId = normId;
  while (currentId.includes(":")) {
    currentId = currentId.substring(0, currentId.lastIndexOf(":"));
    if (isKingdom(currentId)) return currentId;
  }

  // 2. Trace back through dynamic/static imports
  const anchor = findEffectiveAnchor(boundaryId, worldState, {
    fileId: normId.split(":")[0],
    anchors: metadataGraph[normId.split(":")[0]]?.anchorSites || [],
    sinks: [],
    manualTranslations: [],
  } as any);

  if (anchor) {
    return anchor.boundaryId.replace(/\.[^/.]+$/, "");
  }

  // 3. Fallback to Chunk Graph owner
  const owner = resolveOwner(boundaryId, worldState);
  if (isKingdom(owner)) return owner;

  // 4. Final fallback: If the owner is a file that is an entry, it's the kingdom
  const ownerFileId = owner.split(":")[0];
  if (metadataGraph[ownerFileId]?.isEntry) return owner;

  return owner;
}

/**
 * Find the anchor site that activates a given boundary.
 */
export function findEffectiveAnchor(
  boundaryId: string,
  worldState: WorldState,
  observation: FileObservation,
  providedOwnerId?: string,
): ObservedAnchor | undefined {
  const { config } = worldState;
  const relativeId = boundaryId.startsWith(config.root)
    ? boundaryId.substring(config.root.length).replace(/^\/+/, "")
    : boundaryId;
  const normId = relativeId.replace(/\.(?:ts|tsx|js|jsx)$/, "");

  let currentId = normId;
  while (true) {
    const local = observation.anchors.find((a) => {
      const aId = a.boundaryId.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      return aId === currentId || aId.startsWith(currentId + ":");
    });
    if (local) return local;
    if (!currentId.includes(":")) break;
    currentId = currentId.substring(0, currentId.lastIndexOf(":"));
  }

  const ownerId = providedOwnerId || resolveOwner(boundaryId, worldState);
  const root = worldState.config.root;
  const isDev = worldState.config.isDev;

  for (const meta of Object.values(worldState.metadataGraph)) {
    const candidates = (meta as any).anchors || (meta as any).anchorSites || [];
    const site = candidates.find((s: ObservedAnchor) => {
      const siteOwnerId = resolveOwner(s.boundaryId, worldState);
      const siteHash = calculateSafeBoundaryId(siteOwnerId, root, isDev);
      const targetHash = calculateSafeBoundaryId(ownerId, root, isDev);

      const sIdRaw = s.boundaryId;
      const sId = sIdRaw.replace(/\.[^/.]+$/, "");
      const sIdRel = sId.startsWith(root) ? sId.substring(root.length).replace(/^\/+/, "") : sId;
      const sHash = calculateSafeBoundaryId(sIdRel, root, isDev);

      return (
        siteHash === targetHash ||
        siteOwnerId === ownerId ||
        sHash === ownerId ||
        sIdRel === ownerId ||
        sId === ownerId ||
        sIdRaw === ownerId
      );
    });

    if (site) {
      return {
        location: site.location,
        scope: site.scope,
        boundaryId: site.boundaryId,
        locale: site.locale,
        isTopLevel: site.isTopLevel,
        originalName: site.originalName,
      };
    }
  }

  // Trace back through dynamic imports if still not found
  for (const [parentId, deps] of Object.entries(worldState.dependencyGraph)) {
    if (
      deps.some((d) => {
        if (!d.dynamic) return false;
        const depOwner = resolveOwner(d.id, worldState, parentId);
        return depOwner === ownerId || depOwner.split(":")[0] === ownerId.split(":")[0];
      })
    ) {
      const parentObservation = worldState.metadataGraph[parentId] as any;
      if (parentObservation) {
        // Recursively find the anchor for the parent
        // Use a simple observation mock since we only care about the metadata graph part
        const parentAnchor = findEffectiveAnchor(parentId, worldState, {
          fileId: parentId,
          anchors: parentObservation.anchorSites || [],
          sinks: [],
          manualTranslations: [],
        } as any);
        if (parentAnchor) return parentAnchor;
      }
    }
  }

  return undefined;
}

/**
 * Check if a boundary owner has any translatable content.
 */
function isLiveOwner(ownerId: string, worldState: WorldState): boolean {
  const { chunkGraph, manifest, boundaryGraph } = worldState;

  let pathId = ownerId;
  if (!boundaryGraph.nodes.has(ownerId)) {
    const root = worldState.config.root;
    const isDev = worldState.config.isDev;
    for (const bId of boundaryGraph.nodes.keys()) {
      if (
        bId === ownerId ||
        calculateBoundaryId(bId, root, isDev) === ownerId ||
        calculateSafeBoundaryId(bId, root, isDev) === ownerId
      ) {
        pathId = bId;
        break;
      }
    }
  }

  const normPathId = pathId.replace(/\.(?:ts|tsx|js|jsx)$/, "");
  const resolvedOwnerId = chunkGraph.boundaryToOwner.get(normPathId);
  if (!resolvedOwnerId) return false;

  const meta = worldState.metadataGraph[resolvedOwnerId];
  if (meta?.hasZintlMarker) return true;

  if (meta?.anchorSites && meta.anchorSites.some((a: any) => a.originalName !== "implicit-anchor"))
    return true;
  for (const chunk of chunkGraph.chunks.values()) {
    for (const bId of chunk.boundaries) {
      const normBId = bId.replace(/\.(?:ts|tsx|js|jsx)$/, "");
      const bOwner = chunkGraph.boundaryToOwner.get(normBId);
      if (bOwner === resolvedOwnerId) {
        if ((manifest[normBId]?.length || 0) > 0) return true;
      }
    }
  }

  return false;
}

/** Generate the manager virtual module URL. */
export function generateManagerUrl(
  ownerId: string,
  stableId: string,
  worldState: WorldState,
): string {
  const { boundaryGraph, chunkGraph } = worldState;
  const isOwnerEntry = boundaryGraph.entries.has(ownerId);

  let chunkType = "boundary";
  for (const chunk of chunkGraph.chunks.values()) {
    if (chunk.boundaries.has(ownerId)) {
      chunkType = chunk.type;
      break;
    }
  }
  if (isOwnerEntry) chunkType = "entry";

  let syncLocale = "none";
  const reachableNodeIds = Array.from(worldState.boundaryGraph.entries).filter((e) => {
    const owner = resolveOwner(e, worldState);
    return owner === ownerId;
  });

  let hasDynamicAnchor = false;
  for (const rId of reachableNodeIds) {
    const normRId = rId.replace(/\.[^/.]+$/, "");
    const fileId = normRId.split(":")[0];
    const meta = worldState.metadataGraph[fileId];
    if (meta?.anchorSites?.some((s: any) => s.locale.type === "expression")) {
      hasDynamicAnchor = true;
      break;
    }
  }

  if (!hasDynamicAnchor) {
    const normOwnerId = ownerId.replace(/\.(?:ts|tsx|js|jsx)$/, "");
    const entryId = normOwnerId.includes(":") ? normOwnerId.split(":")[0] : normOwnerId;
    const meta = worldState.metadataGraph[entryId];
    if (meta?.anchorSites) {
      const site = meta.anchorSites.find((s: any) => {
        const normSId = s.boundaryId.replace(/\.(?:ts|tsx|js|jsx)$/, "");
        return normSId === normOwnerId;
      });
      if (site?.locale.type === "literal") {
        syncLocale = site.locale.value;
      }
    }
  }

  return `virtual:zintl/manager/${syncLocale}/${chunkType}:${encodeURIComponent(stableId)}`;
}

export function mapVariables(sink: ObservedSink): VariableBinding[] {
  const vars = sink.variables.map((v) => ({
    name: v.name,
    expr: v.expression,
  }));

  if (sink.passVars) {
    for (const [name, expr] of Object.entries(sink.passVars)) {
      // Avoid duplicates if a variable was already captured by extraction
      if (!vars.find((v) => v.name === name)) {
        vars.push({ name, expr });
      }
    }
  }
  return vars;
}

/**
 * Get all reachable boundaries for an anchor's handshake.
 */
export function getReachableHandshake(
  startId: string,
  worldState: WorldState,
): { reachable: string[]; handshake: string[]; colonies: string[] } {
  if (!startId) {
    return {
      reachable: [],
      handshake: [],
      colonies: [],
    };
  }

  const reachable = new Set<string>();
  const handshake = new Set<string>();
  const colonies = new Set<string>();
  const visited = new Set<string>();

  const walk = (id: string) => {
    if (!id || visited.has(id)) return;
    visited.add(id);

    const owner = resolveKingdom(id, worldState);
    if (isLiveOwner(owner, worldState)) {
      reachable.add(owner);
      if (id !== startId) {
        // Only add to handshake if it's an independent Kingdom
        const fileId = owner.includes(":") ? owner.split(":")[0] : owner;
        const meta = worldState.metadataGraph[fileId];
        if (meta?.anchorSites?.length || meta?.hasZintlMarker) {
          handshake.add(owner);
        } else {
          colonies.add(owner);
        }
      }
    }

    const fileId = id.includes(":") ? id.split(":")[0] : id;
    const fileMeta = worldState.metadataGraph[fileId];

    // Collect all dependencies for this ID and its file-level siblings
    const allDeps: any[] = [...(worldState.dependencyGraph[fileId] || [])];

    if (fileMeta?.internalDependencies) {
      if (id.includes(":")) {
        // Specific node dependencies
        allDeps.push(...((fileMeta.internalDependencies[id] || []) as any[]));
      } else {
        // Broad file scan: pick up ALL internal dependencies if walking the file level
        for (const deps of Object.values(fileMeta.internalDependencies)) {
          allDeps.push(...(deps as any[]));
        }
      }
    }

    for (const dep of allDeps) {
      // Normalize dep path
      let depFileId = dep.id;
      if (!depFileId) continue;
      if (depFileId.startsWith(".")) {
        const parentDir = fileId.includes("/") ? fileId.substring(0, fileId.lastIndexOf("/")) : "";
        depFileId = parentDir
          ? `${parentDir}/${depFileId.replace(/^\.\//, "")}`
          : depFileId.replace(/^\.\//, "");
        while (depFileId.includes("/../")) {
          depFileId = depFileId.replace(/[^/]+\/\.\.\//, "");
        }
      }
      const normDepId = depFileId.replace(/\.(?:ts|tsx|js|jsx)$/, "").replace(/^\/+/, "");

      if (!dep.dynamic) {
        walk(normDepId);
      } else {
        // Dynamic import: check for function-level boundaries (Colonies or nested Kingdoms)
        const depMeta = worldState.metadataGraph[normDepId];
        if (depMeta?.exportedBoundaries && Object.keys(depMeta.exportedBoundaries).length > 0) {
          for (const [, bId] of Object.entries(depMeta.exportedBoundaries)) {
            const fullBId = bId.includes(":") ? bId : `${normDepId}:${bId}`;
            const depOwner = resolveOwner(fullBId, worldState);
            reachable.add(depOwner);

            // Only add to handshake if it has its own anchor (Kingdom), not if it's a Colony
            const bFileId = fullBId.split(":")[0];
            const bMeta = worldState.metadataGraph[bFileId];
            if (bMeta?.anchorSites?.length || bMeta?.hasZintlMarker) {
              handshake.add(depOwner);
            } else {
              colonies.add(fullBId);
            }
          }
        } else {
          const depOwner = resolveOwner(normDepId, worldState);
          reachable.add(depOwner);

          const bMeta = worldState.metadataGraph[normDepId];
          if (bMeta?.anchorSites?.length || bMeta?.hasZintlMarker) {
            handshake.add(depOwner);
          } else {
            colonies.add(depOwner);
          }
        }
      }
    }
  };

  walk(startId);

  // If we are starting from a function-scoped Kingdom, also walk the parent file's dependencies
  // to pick up sibling Colonies that might be imported at the module level.
  if (startId.includes(":")) {
    const parentFileId = startId.split(":")[0];
    walk(parentFileId);
  }

  // Ensure the entry itself is always in the handshake
  const entryOwner = resolveKingdom(startId, worldState);
  reachable.add(entryOwner);
  handshake.add(entryOwner);

  return {
    reachable: Array.from(reachable).sort(),
    handshake: Array.from(handshake).sort(),
    colonies: Array.from(colonies).sort(),
  };
}
