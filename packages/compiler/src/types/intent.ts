import type { SourceLocation } from "./ast.js";
import type { AnchorLocale, ObservedSink, TagMapEntry } from "./observation.js";

/**
 * A transform intent — a desired transformation.
 */
export type TransformIntent =
  | ImportIntent
  | AnchorRewriteIntent
  | SinkWrapIntent
  | ManualTRewriteIntent
  | ManagerInjectionIntent
  | BakingIntent
  | SourceLocalePassthroughIntent
  | MarkerRemovalIntent;

interface ImportIntent {
  type: "import";
  source: string;
  specifiers: string[];
  strategy: "merge" | "prepend" | "replace" | "new";
  targetImport?: SourceLocation;
}

export interface AnchorRewriteIntent {
  type: "anchor_rewrite";
  location: SourceLocation;
  boundaryId: string;
  loaders: LoaderEntry[];
  locale?: AnchorLocale;
  originalName: string;
}

export interface LoaderEntry {
  stableId: string;
  safeId: string;
  boundaryId: string;
}

export interface SinkWrapIntent {
  type: "sink_wrap";
  sink: ObservedSink;
  messageId: string;
  boundaryId: string;
  ownerId: string;
  safeId: string;
  variables?: VariableBinding[];
  isDev: boolean;
}

export interface ManualTRewriteIntent {
  type: "manual_t_rewrite";
  location: SourceLocation;
  originalKey: string;
  messageId: string;
  boundaryId: string;
  ownerId: string;
  safeId: string;
  paramsSource?: string;
  isDev: boolean;
}

interface ManagerInjectionIntent {
  type: "manager_injection";
  ownerId: string;
  safeId: string;
  stableId: string;
  managerUrl: string;
  reason: "self" | "handshake" | "anchor_reachable" | "sink" | "manual_t";
}

export interface BakingIntent {
  type: "baking";
  sink: ObservedSink;
  messageId: string;
  translation: string | Record<string, string>;
  variables?: VariableBinding[];
  tagMap?: TagMapEntry[];
  isDev: boolean;
}

interface SourceLocalePassthroughIntent {
  type: "source_locale_passthrough";
  sink: ObservedSink;
  reason: "source_locale_baking";
}

interface MarkerRemovalIntent {
  type: "marker_removal";
  start: number;
  end: number;
  replacement: "";
  kind: "marker_removal";
}

export interface VariableBinding {
  name: string;
  expr: string;
}
