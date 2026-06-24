import type { HtmlProjectionPayload, TagMapEntry } from "@zintl/extractor";
export type { HtmlProjectionPayload, TagMapEntry };
import type { SourceLocation, ImportSpecifier } from "./ast.js";

/**
 * Anchor locale — whether the zintl() call received a static string or a dynamic expression.
 */
export type AnchorLocale =
  | { type: "literal"; value: string }
  | { type: "expression"; source: string }
  | { type: "none" };

/**
 * The complete, immutable observation of a single source file.
 */
export interface FileObservation {
  sinks: ObservedSink[];
  manualTranslations: ObservedManualT[];
  anchors: ObservedAnchor[];
  imports: ObservedImport[];
  dependencies: ObservedDependency[];
  boundaries: ObservedBoundary[];
  directives: ObservedDirective[];
  fileId: string;
  hasZintlMarker: boolean;
  hasZintlMacro: boolean;
  contentHash: string;
  componentFunctions?: number[];
  isClientComponent?: boolean;
  zintlImportLocation?: SourceLocation;
  existingRuntimeImports: string[];
  exportedBoundaries: Record<string, string>;
  internalDependencies: Record<string, string[]>;
  htmlProjection?: HtmlProjectionPayload;
}

/**
 * A raw string found in a UI-relevant position.
 */
export interface ObservedSink {
  text: string;
  boundaryId: string;
  rawText: string;
  sinkType: string;
  location: SourceLocation;
  variables: ObservedVariable[];
  note?: string;
  passVars?: Record<string, string>;
  isFragment: boolean;
  fragmentLocation?: SourceLocation;
  hostNodeLocation?: SourceLocation;
  requiresQuoteConversion?: boolean;
  requiresJsxBraces?: boolean;
  tagMap?: TagMapEntry[];
}

/**
 * An explicit t("key") call written by the user.
 */
export interface ObservedManualT {
  key: string;
  location: SourceLocation;
  boundaryId: string;
  paramsSource?: string;
}

/**
 * A zintl() call site — the trust anchor that activates translation.
 */
export interface ObservedAnchor {
  location: SourceLocation;
  scope: "module" | "function";
  boundaryId: string;
  locale: AnchorLocale;
  isTopLevel: boolean;
  originalName: string;
  statementLocation?: SourceLocation;
  detectionCode?: string;
}

/**
 * An import declaration in the source file.
 */
export interface ObservedImport {
  source: string;
  specifiers: ImportSpecifier[];
  location: SourceLocation;
  isDynamic: boolean;
}

/**
 * A dependency on another file.
 */
export interface ObservedDependency {
  id: string;
  dynamic: boolean;
  bindings: string[];
}

/**
 * An interpolated expression within a UI sink.
 */
interface ObservedVariable {
  name: string;
  originalName: string;
  expression: string;
  sourceRange: SourceLocation;
}

/**
 * A boundary scope detected in the file.
 */
export interface ObservedBoundary {
  id: string;
  isActive: boolean;
  parentId: string | null;
  scope: "module" | "function";
}

/**
 * A zintl directive found in a comment.
 */
interface ObservedDirective {
  type: "ignore" | "note" | "pass";
  content: string;
  location: SourceLocation;
  parsedVars?: Record<string, string>;
}
