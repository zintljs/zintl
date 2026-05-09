import type { BoundaryDep, HtmlProjectionPayload } from "@zintl/extractor";
import type { ObservedAnchor } from "./observation.js";

/** Maps boundary id → its direct dependencies. */
export type DependencyGraph = Record<string, BoundaryDep[]>;

export interface BoundaryMetadata {
  hasZintlMacro: boolean;
  hasZintlMarker: boolean;
  isEntry: boolean;
  anchorSites: ObservedAnchor[];
  needsLoader: boolean;
  exportedBoundaries: Record<string, string>;
  internalDependencies: Record<string, string[]>;
  htmlProjection?: HtmlProjectionPayload;
}

/** Maps boundary id → metadata. */
export type MetadataGraph = Record<string, BoundaryMetadata>;

/** Boundary graph node. */
export interface Boundary {
  id: string;
  mode: "entry" | "boundary";
  deps: BoundaryDep[];
  usageCount: number;
  filePath: string;
  activeLocales: Set<string> | "all";
}

/** Complete boundary graph. */
export interface BoundaryGraph {
  nodes: Map<string, Boundary>;
  entries: Set<string>;
}

/** Chunk classification. */
export interface ChunkInfo {
  id: string;
  type: "entry" | "lazy" | "shared";
  boundaries: Set<string>;
  colonies: Set<string>;
  entrySources: Set<string>;
}

/** Chunk graph. */
export interface ChunkGraph {
  chunks: Map<string, ChunkInfo>;
  entryChunks: Map<string, string>;
  lazyChunks: Set<string>;
  sharedChunks: Set<string>;
  boundaryToOwner: Map<string, string>;
}
