import { calculateSafeBoundaryId, calculateBoundaryId } from "../utils/hashing.js";
import type {
  WorldState,
  ObservedSink,
  ObservedAnchor,
  FileObservation,
  VariableBinding,
} from "../types/index.js";

/**
 * Normalize a boundary id to the spelling every map in the system is keyed by.
 *
 * ## This rule is shared, and the three copies of it must agree
 *
 * Strip the *logic* extensions (`.ts`, `.js`) so a file keeps its identity when
 * it moves between JS and TS; keep everything else, because `.tsx` and `.jsx`
 * are part of how a boundary is named and `.vue`/`.svelte`/`.html` name a
 * document rather than a compilation target.
 *
 * The same rule is implemented in {@link IOManager.getNormalizedId}, which keys
 * the boundary graph and the ownership map, and in
 * {@link calculateSafeBoundaryId}, which mints the ids that reach emitted code.
 * All three have to answer identically or the maps stop meeting.
 *
 * ## They did not, and the failure was silent in both directions
 *
 * This copy used to strip `.tsx` and `.jsx` as well. That is invisible for a
 * *function-scoped* id, because the regex is anchored at end-of-string and
 * `src/main.tsx:boot` has no trailing extension — it came back untouched and
 * matched the graph by accident. A **module-scoped** id did not:
 * `src/main.tsx` became `src/main`, which names no node.
 *
 * Downstream, `resolveKingdom` returned that as the owner id, so
 * `generateManagerUrl` classified an entry chunk's owner as `boundary:` and
 * `calculateSafeBoundaryId` minted `b_src_main` for a chunk called
 * `b_src_main_tsx`. The manager was generated for an id naming no chunk: it
 * loaded with a 200 and registered no catalog, and every string in any *other*
 * boundary rendered pseudo-localized. A top-level `zintl()` — the shape
 * CLAUDE.md documents as the definition of an entry point — was broken for
 * `.tsx` and `.jsx` projects, and no example used it.
 *
 * If a fourth copy of this ever seems necessary, it is not.
 */
function stripExtensions(id: string, extensions?: string[], codegenFacets?: any[]): string {
  const exts = extensions || [".ts", ".tsx", ".js", ".jsx", ".html"];
  const sfcExts = (codegenFacets || [])
    .map((a) => {
      const isSfc = !!a.wrapSfcScript;
      if (!isSfc) return [];
      return a.extensions || [];
    })
    .flat();
  const keepExts = [".html", ".tsx", ".jsx", ...sfcExts];
  const stripExts = exts.filter(
    (ext) => !keepExts.some((k) => k.toLowerCase() === ext.toLowerCase()),
  );

  const escapedExts = stripExts
    .map((e) => (e.startsWith(".") ? e.slice(1) : e))
    .map((e) => e.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
  if (escapedExts.length === 0) return id;
  const regex = new RegExp(`\\.(?:${escapedExts.join("|")})$`);
  return id.replace(regex, "");
}

function getMeta(id: string, metadataGraph: any, extensions?: string[], codegenFacets?: any[]) {
  if (!id) return undefined;
  if (metadataGraph[id]) return metadataGraph[id];
  const clean = stripExtensions(id, extensions, codegenFacets);
  if (metadataGraph[clean]) return metadataGraph[clean];
  const exts = extensions || [".ts", ".tsx", ".js", ".jsx", ".html"];
  for (const ext of exts) {
    const suffix = ext.startsWith(".") ? ext : `.${ext}`;
    if (metadataGraph[clean + suffix]) return metadataGraph[clean + suffix];
  }
  return undefined;
}

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
  const normId = stripExtensions(
    relativeId,
    config.extensions,
    config.system?.codegenFacets,
  ).replace(/^\/+/, "");

  const owner = chunkGraph.boundaryToOwner.get(normId);
  if (owner) return owner;

  // Fallback for function-scoped boundaries: use the file-level owner
  if (normId.includes(":")) {
    const fileId = normId.split(":")[0];
    const fileOwner = chunkGraph.boundaryToOwner.get(fileId);
    if (fileOwner) return fileOwner;
  }

  let currentId = normId;
  while (currentId.includes(":")) {
    currentId = currentId.substring(0, currentId.lastIndexOf(":"));
    const parentOwner = chunkGraph.boundaryToOwner.get(currentId);
    if (parentOwner) return parentOwner;
  }

  // Fallback for file-level boundaries: if it has exported boundaries, resolve using the first exported boundary's owner!
  const meta = getMeta(
    normId,
    worldState.metadataGraph,
    config.extensions,
    config.system?.codegenFacets,
  );
  if (meta?.exportedBoundaries) {
    for (const bId of Object.values(meta.exportedBoundaries)) {
      const resolvedBId = bId as string;
      const cleanBId = resolvedBId.includes(":") ? resolvedBId : `${normId}:${resolvedBId}`;
      const bOwner = chunkGraph.boundaryToOwner.get(cleanBId);
      if (bOwner) return bOwner;
    }
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
  const normId = stripExtensions(relativeId, config.extensions, config.system?.codegenFacets);

  const isKingdom = (b: string) => {
    const fId = b.split(":")[0];
    const m = getMeta(fId, metadataGraph, config.extensions, config.system?.codegenFacets);
    if (!m) return false;
    // A file with zintl-marker is a Kingdom (Axiom 5)
    if (m.hasZintlMarker && !b.includes(":")) return true;
    // A function with a zintl() call is a Kingdom (Axiom 5)
    return (m.anchorSites || []).some((s: any) => {
      const sId = stripExtensions(s.boundaryId, config.extensions, config.system?.codegenFacets);
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
  const normMeta = getMeta(
    normId.split(":")[0],
    metadataGraph,
    config.extensions,
    config.system?.codegenFacets,
  );
  const anchor = findEffectiveAnchor(
    boundaryId,
    worldState,
    {
      fileId: normId.split(":")[0],
      anchors: normMeta?.anchorSites || [],
      sinks: [],
      manualTranslations: [],
    } as any,
    undefined,
    new Set(),
  );

  if (anchor) {
    return stripExtensions(anchor.boundaryId, config.extensions, config.system?.codegenFacets);
  }

  // 3. Fallback to Chunk Graph owner
  const owner = resolveOwner(boundaryId, worldState);
  if (isKingdom(owner)) return owner;

  // 4. Final fallback: If the owner is a file that is an entry, it's the kingdom
  const ownerFileId = owner.split(":")[0];
  if (getMeta(ownerFileId, metadataGraph, config.extensions, config.system?.codegenFacets)?.isEntry)
    return owner;

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
  seen: Set<string> = new Set(),
): ObservedAnchor | undefined {
  const { config } = worldState;

  if (seen.has(boundaryId)) return undefined;
  seen.add(boundaryId);

  const relativeId = boundaryId.startsWith(config.root)
    ? boundaryId.substring(config.root.length).replace(/^\/+/, "")
    : boundaryId;
  const normId = stripExtensions(relativeId, config.extensions, config.system?.codegenFacets);

  let currentId = normId;
  while (true) {
    const local = observation.anchors.find((a) => {
      const aId = stripExtensions(a.boundaryId, config.extensions, config.system?.codegenFacets);
      return aId === currentId;
    });
    if (local) {
      if (
        config.bakedLocale &&
        (local.locale.type === "none" ||
          (local.locale.type === "expression" && !local.locale.source))
      ) {
        return {
          ...local,
          locale: { type: "literal", value: config.bakedLocale },
        };
      }
      return local;
    }
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
      const sId = stripExtensions(sIdRaw, config.extensions, config.system?.codegenFacets);
      const sIdRel = sId.startsWith(root) ? sId.substring(root.length).replace(/^\/+/, "") : sId;
      const sHash = calculateSafeBoundaryId(sIdRel, root, isDev);

      return (
        siteOwnerId === ownerId ||
        siteHash === targetHash ||
        sHash === ownerId ||
        sIdRel === ownerId ||
        sId === ownerId ||
        sIdRaw === ownerId
      );
    });

    if (site) {
      let locale = site.locale;
      if (
        config.bakedLocale &&
        (locale.type === "none" || (locale.type === "expression" && !locale.source))
      ) {
        locale = { type: "literal", value: config.bakedLocale };
      }
      return {
        location: site.location,
        scope: site.scope,
        boundaryId: site.boundaryId,
        locale,
        isTopLevel: site.isTopLevel,
        originalName: site.originalName,
      };
    }
  }

  // Fallback: If the owner itself is an entry point, check its metadata directly
  const ownerMeta = getMeta(
    ownerId.split(":")[0],
    worldState.metadataGraph,
    worldState.config.extensions,
    worldState.config.system?.codegenFacets,
  );
  if (ownerMeta?.isEntry && ownerMeta.anchorSites?.length > 0) {
    const site = ownerMeta.anchorSites[0];
    let locale = site.locale;
    if (
      config.bakedLocale &&
      (locale.type === "none" || (locale.type === "expression" && !locale.source))
    ) {
      locale = { type: "literal", value: config.bakedLocale };
    }
    return { ...site, locale };
  }

  // Trace back through imports if still not found
  for (const [parentId, deps] of Object.entries(worldState.dependencyGraph)) {
    if (
      deps.some((d) => {
        const depOwner = resolveOwner(d.id, worldState, parentId);
        return depOwner === ownerId || depOwner.split(":")[0] === ownerId.split(":")[0];
      })
    ) {
      const parentObservation = getMeta(
        parentId,
        worldState.metadataGraph,
        worldState.config.extensions,
        worldState.config.system?.codegenFacets,
      ) as any;
      if (parentObservation) {
        // Recursively find the anchor for the parent
        // Use a simple observation mock since we only care about the metadata graph part
        const parentAnchor = findEffectiveAnchor(
          parentId,
          worldState,
          {
            fileId: parentId,
            anchors: parentObservation.anchorSites || [],
            sinks: [],
            manualTranslations: [],
          } as any,
          undefined,
          seen,
        );
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

  const normPathId = stripExtensions(
    pathId,
    worldState.config.extensions,
    worldState.config.system?.codegenFacets,
  );
  const resolvedOwnerId = chunkGraph.boundaryToOwner.get(normPathId);
  if (!resolvedOwnerId) return false;

  const meta = getMeta(
    resolvedOwnerId,
    worldState.metadataGraph,
    worldState.config.extensions,
    worldState.config.system?.codegenFacets,
  );
  if (meta?.hasZintlMarker) return true;

  if (meta?.anchorSites && meta.anchorSites.some((a: any) => a.originalName !== "implicit-anchor"))
    return true;
  for (const chunk of chunkGraph.chunks.values()) {
    for (const bId of chunk.boundaries) {
      const normBId = stripExtensions(
        bId,
        worldState.config.extensions,
        worldState.config.system?.codegenFacets,
      );
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
    const normRId = stripExtensions(
      rId,
      worldState.config.extensions,
      worldState.config.system?.codegenFacets,
    );
    const fileId = normRId.split(":")[0];
    const meta = getMeta(
      fileId,
      worldState.metadataGraph,
      worldState.config.extensions,
      worldState.config.system?.codegenFacets,
    );
    if (meta?.anchorSites?.some((s: any) => s.locale.type === "expression")) {
      hasDynamicAnchor = true;
      break;
    }
  }

  if (!hasDynamicAnchor) {
    const normOwnerId = stripExtensions(
      ownerId,
      worldState.config.extensions,
      worldState.config.system?.codegenFacets,
    );
    const entryId = normOwnerId.includes(":") ? normOwnerId.split(":")[0] : normOwnerId;
    const meta = getMeta(
      entryId,
      worldState.metadataGraph,
      worldState.config.extensions,
      worldState.config.system?.codegenFacets,
    );
    if (meta?.anchorSites) {
      const site = meta.anchorSites.find((s: any) => {
        const normSId = stripExtensions(
          s.boundaryId,
          worldState.config.extensions,
          worldState.config.system?.codegenFacets,
        );
        return normSId === normOwnerId;
      });
      if (site?.locale.type === "literal") {
        syncLocale = site.locale.value;
      }
    }
  }

  const rawPath = `virtual:zintl/manager/${syncLocale}/${chunkType}:${encodeURIComponent(stableId)}`;
  const resolveFn = worldState.config.system?.resolveVirtualPath;
  return resolveFn ? resolveFn(rawPath) : rawPath;
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
      const fileId = owner.includes(":") ? owner.split(":")[0] : owner;
      const meta = getMeta(
        fileId,
        worldState.metadataGraph,
        worldState.config.extensions,
        worldState.config.system?.codegenFacets,
      );
      if (meta?.anchorSites?.length || meta?.hasZintlMarker) {
        handshake.add(owner);
      } else {
        colonies.add(owner);
      }
    }

    const fileId = id.includes(":") ? id.split(":")[0] : id;
    const fileMeta = getMeta(
      fileId,
      worldState.metadataGraph,
      worldState.config.extensions,
      worldState.config.system?.codegenFacets,
    );

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
      const normDepId = stripExtensions(
        depFileId,
        worldState.config.extensions,
        worldState.config.system?.codegenFacets,
      ).replace(/^\/+/, "");

      if (!dep.dynamic) {
        const depMeta = getMeta(
          normDepId,
          worldState.metadataGraph,
          worldState.config.extensions,
          worldState.config.system?.codegenFacets,
        );
        if (dep.bindings?.length && depMeta?.exportedBoundaries) {
          for (const binding of dep.bindings) {
            const resolvedBId = depMeta.exportedBoundaries[binding];
            if (resolvedBId) {
              const fullBId = resolvedBId.includes(":")
                ? resolvedBId
                : `${normDepId}:${resolvedBId}`;
              walk(fullBId);
            } else {
              walk(normDepId);
            }
          }
        } else {
          walk(normDepId);
        }
      } else {
        // Dynamic import: check for function-level boundaries (Colonies or nested Kingdoms)
        const depMeta = getMeta(
          normDepId,
          worldState.metadataGraph,
          worldState.config.extensions,
          worldState.config.system?.codegenFacets,
        );
        if (depMeta?.exportedBoundaries && Object.keys(depMeta.exportedBoundaries).length > 0) {
          for (const [, bIdRaw] of Object.entries(depMeta.exportedBoundaries)) {
            const bId = bIdRaw as string;
            const fullBId = bId.includes(":") ? bId : `${normDepId}:${bId}`;
            const depOwner = resolveOwner(fullBId, worldState);
            reachable.add(depOwner);

            // Only add to handshake if it has its own anchor (Kingdom), not if it's a Colony
            const bFileId = fullBId.split(":")[0];
            const bMeta = getMeta(
              bFileId,
              worldState.metadataGraph,
              worldState.config.extensions,
              worldState.config.system?.codegenFacets,
            );
            if (bMeta?.anchorSites?.length || bMeta?.hasZintlMarker) {
              handshake.add(depOwner);
            } else {
              colonies.add(fullBId);
            }
          }
        } else {
          const depOwner = resolveOwner(normDepId, worldState);
          reachable.add(depOwner);

          const bMeta = getMeta(
            normDepId,
            worldState.metadataGraph,
            worldState.config.extensions,
            worldState.config.system?.codegenFacets,
          );
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
