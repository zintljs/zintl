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
  /** If true, this module contains a side-effect import "zintljs" ($M). */
  hasZintlMarker: boolean;
  /** Locations of zintl calls for compiler-driven catalog injection. */
  anchorSites: AnchorSite[];
  mode: "entry" | "boundary";
  runtimeImports: string[];
  dependencies: BoundaryDep[];
  usedKeys: Set<string>;
  /**
   * Map of boundaryId -> `b_` + the first 12 hex of `sha1(boundaryId)`.
   *
   * A hash of the **id**, not of the messages. The comment here used to read
   * "sha1 hash of its messages (text+context+note)", which describes something
   * this has never done — `computeBoundaryHashes` has exactly one assignment
   * and it hashes `bId` alone. Worth correcting rather than leaving, because a
   * hash that appeared to cover message text would look like the mechanism that
   * detects message changes, and it is not one.
   *
   * Message identity is separate and lives in `generateMessageId`, which hashes
   * the source text alone — deliberately ignoring its `_context` and `_note`
   * parameters, so one string reached through two attributes stays one message.
   */
  boundaryHashes: Record<string, string>;
  /** Location and actual source of existing import from "zintljs" used for merging. */
  zintlImportGroup?: { start: number; end: number; source: string };
  /** Map of exported identifier -> internal boundary ID. */
  exportedBoundaries: Record<string, string>;

  /** Map of parent boundary -> set of child boundaries it depends on (local calls) */
  internalDeps: Record<string, string[]>;
  /** Full-fidelity UI sink observations captured at the visitor level. */
  rawSinks: RawSink[];
  /** Explicit t() calls captured at the visitor level. */
  rawManualTranslations: RawManualT[];
  /** Component function insertion positions (e.g. function body block starts). */
  componentFunctions?: number[];

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
  /**
   * Where this text sits, as something to *show* a translator — `h1`, `p`, `alt`.
   *
   * Split from {@link RawSink.sinkType} rather than folded into it, because that
   * field is replacement mechanics: `resolve-rewrites.ts` and the html facet
   * both branch on `sinkType === "HTML_TEXT"` to decide how to splice a call
   * back into source. Proposal 032 §2 draws the same line — `contexts` is
   * human-facing, `sinkTypes` is transport — and this is the human half made
   * reachable, since the compiler never sees `ExtractedMessage.contexts`.
   *
   * Only set where it says something `sinkType` does not. JSX already reports
   * the element it found the text in; HTML text does not, and that is the gap
   * this closes.
   */
  context?: string;
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

/**
 * A structural sink descriptor.
 *
 * Deliberately framework-blind: there are no `"react"` / `"vue"` / `"svelte"` /
 * `"nextjs"` members. Framework presets live in `@zintljs/compiler/facets` and
 * expand to these low-level forms before they ever reach the extractor.
 */
export type TargetDescriptor =
  | `jsx:*:${string}`
  | `jsx:${string}:${string}`
  /**
   * The contents of a template literal tagged with this identifier are markup.
   *
   * `tag:html` reads Lit's ``html`<p>Hello</p>` ``, but nothing here is Lit:
   * "a tagged template holds markup" is a structural fact about the syntax, and
   * htm, uhtml and any other tagged-template library get it for the same
   * declaration. What makes it *Lit* support is a facet naming the tag, which is
   * where framework knowledge belongs.
   */
  | `tag:${string}`
  | `dom:prop:${string}`
  /**
   * Receiver-qualified: `dom:document:title` matches only `document.title`.
   * `dom:prop:` and `dom:*:` mean any receiver.
   *
   * `dom:attr:` was listed here and never implemented; it is now rejected at
   * construction rather than silently matching nothing.
   */
  | `dom:${string}:${string}`
  | `obj:${string}:${string}`
  | `call:${string}:${string}`
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

export interface MustacheRule {
  extensions: string[];
  pattern: RegExp;
}

export interface CompiledExtractionState {
  jsxAttributes: Set<string>;
  jsxElementAttributes: Map<string, Set<string>>;
  domProperties: Set<string>;
  /**
   * Receiver-qualified DOM properties: receiver identifier -> property names.
   *
   * `dom:document:title` lands here; `dom:prop:title` lands in
   * {@link domProperties} and matches any receiver. The distinction is the
   * difference between evidence and a guess — `document` is a literal
   * identifier in the source, so `document.title` is known to be the browser
   * tab, where a bare `.title` could be telemetry.
   */
  domReceiverProperties: Map<string, Set<string>>;
  /** Identifiers whose tagged template literals hold markup — see `tag:`. */
  taggedTemplates: Set<string>;
  objectFields: Set<string>;
  /**
   * Binding-qualified object fields: binding identifier -> field names.
   *
   * `obj:ui:title` lands here; `obj:field:title` lands in {@link objectFields}
   * and matches any object literal anywhere. The binding is resolved by walking
   * to the nearest name-carrying ancestor, so a field nested several levels
   * inside `const ui = { … }` still counts.
   */
  objectNameFields: Map<string, Set<string>>;
  /**
   * Call-qualified object fields: callee identifier -> field names.
   *
   * `call:defineConfig:title` matches `defineConfig({ title })`. Kept apart from
   * {@link objectNameFields} because "passed to `cfg()`" and "bound to `cfg`"
   * are different relations that would otherwise collide on one name.
   */
  callFields: Map<string, Set<string>>;
  htmlAttributes: Set<string>;
  plugins: TargetPlugin[];
  fastPathHints: string[];
  uniqueHints: string[];
  fastPathRegex: RegExp;
  hasDomSinks: boolean;
  hasTaggedTemplateSinks: boolean;
  hasJsxSinks: boolean;
  sfcRules: SfcRule[];
  suppressionRules: SuppressionRule[];
  mustacheRegex?: RegExp | null;
  mustacheRules?: MustacheRule[];
}

export interface ExtractionOptions {
  runtimePackage?: string; // default: "zintljs"
  uiAttributes?: Set<string>;
  uiObjectFields?: Set<string>;
  uiSinkProperties?: string[];
  /** @see CompiledExtractionState.domReceiverProperties */
  uiSinkReceiverProperties?: Map<string, Set<string>>;
  /** @see CompiledExtractionState.objectNameFields */
  uiObjectNameFields?: Map<string, Set<string>>;
  /** @see CompiledExtractionState.callFields */
  uiCallFields?: Map<string, Set<string>>;
  targets?: TargetDescriptor[];
  logger?: ZintlLogger;
  isZeroConfig?: boolean;
  sfcRules?: SfcRule[];
  suppressionRules?: SuppressionRule[];
  activeRange?: { start: number; end: number };
  isSfcTemplate?: boolean;
  compiledState?: CompiledExtractionState;
}
