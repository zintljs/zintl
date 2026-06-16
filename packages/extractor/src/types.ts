import type { Node, Expression } from "@oxc-project/types";

export interface ExtractedMessage {
  id: string;
  text: string;
  contexts: string[];
  boundaryId: string;
  location: { line: number; column: number };
  note?: string;
  variables: string[];
  sinkTypes: string[];
  passVars?: Record<string, string>;
}

/** A resolved dependency on another boundary. */
export interface BoundaryDep {
  /** Boundary id (relative path without extension). */
  id: string;
  /** True if reachable only via a dynamic import() expression. */
  dynamic: boolean;
  /** Specific exported identifiers being used from this dependency. */
  bindings?: string[];
}

/** Location of a trust anchor (zintl() call). */
export interface AnchorSite {
  start: number;
  end: number;
  scope: "module" | "function";
  boundaryId: string;
  originalArgs: string;
  argType: "literal" | "expression";
  isTopLevel: boolean;
  originalName: string;
  /** Optional range of the governing statement (e.g. ExpressionStatement including semicolon). */
  statementRange?: { start: number; end: number };
  /** Optional code snippet discovered by tracing the anchor argument for hoisting into bootstrap. */
  detectionCode?: string;
}

export interface HtmlProjectionPayload {
  title?: string;
  description?: string;
  dir?: string;
  /** Found module scripts via <script type="module" src="..."> */
  scripts: string[];
}

export interface ExtractionResult {
  messages: ExtractedMessage[];
  code: string;
  /** List of string replacements (original offsets) to apply to original code. */
  transforms: Transform[];
  needsLoader: boolean;
  /** If true, this module contains at least one trust anchor (zintl). */
  hasZintlMacro: boolean;
  /** If true, this module contains a side-effect import "zintl" ($M). */
  hasZintlMarker: boolean;
  /** Locations of zintl calls for compiler-driven catalog injection. */
  anchorSites: AnchorSite[];
  mode: "entry" | "boundary";
  runtimeImports: string[];
  dependencies: BoundaryDep[];
  usedKeys: Set<string>;
  /** Map of boundaryId -> sha1 hash of its messages (text+context+note) */
  boundaryHashes: Record<string, string>;
  /** Location and actual source of existing import from "zintl" used for merging. */
  zintlImportGroup?: { start: number; end: number; source: string };
  /** Map of exported identifier -> internal boundary ID. */
  exportedBoundaries: Record<string, string>;

  /** Map of parent boundary -> set of child boundaries it depends on (local calls) */
  internalDeps: Record<string, string[]>;
  /** Full-fidelity UI sink observations captured at the visitor level. */
  rawSinks: RawSink[];
  /** Explicit t() calls captured at the visitor level. */
  rawManualTranslations: RawManualT[];

  /** HTML-specific projection data (for .html files). */
  htmlProjection?: HtmlProjectionPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Native Observation Types — captured directly by visitors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A raw UI string captured at the exact point of discovery in a visitor.
 *
 * Unlike the adapter approach (which reconstructs data from transforms),
 * this captures full-fidelity observation data including:
 * - Exact source locations (start/end offsets)
 * - Variable expressions as source code strings
 * - @zintl-pass context variables
 * - Fragment and quote conversion metadata
 */
export interface RawSink {
  /** Stitched text content (after fragmentation + variable normalization). */
  text: string;
  /** UI context: "innerHTML", "title", "h1", "aria-label", "label", etc. */
  sinkType: string;
  /** Start offset in source code for the replaceable range. */
  start: number;
  /** End offset in source code for the replaceable range. */
  end: number;
  /** Source line number. */
  line: number;
  /** Source column number. */
  column: number;
  /** Owning boundary ID. */
  boundaryId: string;
  /** Interpolated variable bindings with source expressions. */
  variables: RawVariable[];
  /** Translator note from @zintl-note. */
  note?: string;
  /** Context variables from @zintl-pass (target-language asymmetry). */
  passVars?: Record<string, string>;
  /** True if this is a fragment within a larger template/string (inline replacement). */
  isFragment: boolean;
  /** True if the replacement requires JSX curly braces wrapping. */
  requiresJsxBraces?: boolean;
  /** If fragment: start offset of the fragment sub-range. */
  fragmentStart?: number;
  /** If fragment: end offset of the fragment sub-range. */
  fragmentEnd?: number;
  /** If fragment: start offset of the enclosing host node. */
  hostStart?: number;
  /** If fragment: end offset of the enclosing host node. */
  hostEnd?: number;
  /** True if the host string literal must be converted to a template literal. */
  requiresQuoteConversion?: boolean;
  /** Phrase tag attribute map (alias -> original open tag). */
  tagMap?: TagMapEntry[];
}

export interface TagMapEntry {
  alias: string;
  originalOpen: string;
  tagName: string;
}

/**
 * A variable binding captured with its source expression.
 */
export interface RawVariable {
  /** Variable name after normalization (e.g. "input", "name"). */
  name: string;
  /** Variable name before normalization (e.g. "var0", "name"). */
  originalName: string;
  /** Source code of the expression (e.g. "user.name", "items.length"). */
  expression: string;
  /** Start offset of the expression in source. */
  start: number;
  /** End offset of the expression in source. */
  end: number;
}

/**
 * An explicit t("key") call captured at the visitor level.
 */
export interface RawManualT {
  /** The string key passed to t("key"). */
  key: string;
  /** Start offset of the t(...) call. */
  start: number;
  /** End offset of the t(...) call. */
  end: number;
  /** Source line number. */
  line: number;
  /** Source column number. */
  column: number;
  /** Owning boundary ID. */
  boundaryId: string;
  /** Optional source code for the parameters object. */
  paramsSource?: string;
}

export interface LiteralSource {
  node: Node;
  text: string;
  context: string;
  location: { line: number; column: number };
  note?: string;
  variables?: string[];
  transformStart?: number;
  transformEnd?: number;
  inlineReplacement?: boolean;
  normalizedVariables?: Record<string, string>;
  passVars?: Record<string, string>;
  tagMap?: TagMapEntry[];
}

export interface BoundaryInfo {
  id: string;
  active: boolean;
}

export interface Transform {
  start: number;
  end: number;
  replacement: string;
  msgId?: string;
  originalText?: string;
  boundaryId: string;
  argNode?: Expression;
}

export type TargetDescriptor =
  | "auto"
  | "react"
  | "nextjs"
  | "vue"
  | "svelte"
  | "html"
  | "vanilla"
  | `jsx:*:${string}`
  | `jsx:${string}:${string}`
  | `dom:prop:${string}`
  | `dom:attr:${string}`
  | `obj:field:${string}`
  | `html:attr:${string}`
  | TargetPlugin;

export interface TargetPlugin {
  name: string;
  resolveOptions?: (base: ExtractionOptions) => Partial<ExtractionOptions>;
  createVisitor?: (ctx: any) => any;
  fastPathHint?: string | string[];
}

export interface SfcBlockRule {
  id: string;
  pattern: RegExp;
  action: "javascript" | "html" | "ignore";
  resolveVirtualExtension?: (attributes: string) => string;
  isActiveContent?: boolean;
}

export interface SfcRule {
  extensions: string[];
  blocks: SfcBlockRule[];
}

export interface SuppressionRule {
  targets?: string[];
  match: {
    types: string[];
    names: string[];
    isTopLevel?: boolean;
  };
  bypassIf?: "hasAnchor";
}

import type { ZintlLogger, LogLevel } from "./logger.js";
export type { ZintlLogger, LogLevel };
export interface ExtractionOptions {
  runtimePackage?: string; // default: "zintl"
  uiAttributes?: Set<string>;
  uiObjectFields?: Set<string>;
  uiSinkProperties?: string[];
  targets?: TargetDescriptor[];
  logger?: ZintlLogger;
  isZeroConfig?: boolean;
  sfcRules?: SfcRule[];
  suppressionRules?: SuppressionRule[];
  activeRange?: { start: number; end: number };
  isSfcTemplate?: boolean;
}
