import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Node, Expression } from "@oxc-project/types";
import type { Comment } from "oxc-parser";
import { RUNTIME_PACKAGE } from "./constants.js";
import { resolveTargets } from "./targets.js";
import { scanTranslatableAttributes } from "./attributes.js";

import {
  ExtractedMessage,
  ExtractionOptions,
  Transform,
  LiteralSource,
  AnchorSite,
  RawSink,
  RawManualT,
  TagMapEntry,
  SfcRule,
  SuppressionRule,
} from "./types.js";
import { parseZintlComments, parseHTMLDirectives } from "./comments.js";
import { logger as defaultLogger, type ZintlLogger } from "./logger.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function getTagName(token: string): string {
  const match = token.match(/^<\/?([a-zA-Z0-9:-]+)/);
  return match ? match[1].toLowerCase() : "";
}

function isSingleWrappingPhrasingTag(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) return false;
  if (trimmed.endsWith("/>")) return false;

  const tokens = trimmed.split(/(<[^>]+>)/g).filter((t) => t.length > 0);
  if (tokens.length < 3) return false;

  const first = tokens[0];
  if (!first.startsWith("<") || first.startsWith("</") || first.startsWith("<!--")) return false;

  const firstTagName = getTagName(first);
  if (!INLINE_PHRASING_TAGS.has(firstTagName.replace(/\d+$/, ""))) return false;

  const last = tokens[tokens.length - 1];
  if (last !== `</${firstTagName}>` && !last.startsWith(`</${firstTagName}`)) return false;

  const stack: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("<") && token.endsWith(">")) {
      if (token.startsWith("<!--")) continue;
      const isClosing = token.startsWith("</");
      const isSelfClosing = token.endsWith("/>");
      if (isSelfClosing) continue;

      const tagName = getTagName(token);
      if (isClosing) {
        if (stack.length === 0) return false;
        const popped = stack.pop();
        if (popped !== tagName) return false;
        if (stack.length === 0 && i < tokens.length - 1) return false;
      } else {
        stack.push(tagName);
      }
    }
  }

  return stack.length === 0;
}

function hasTranslatableText(text: string): boolean {
  let stripped = text.replace(/<[^>]+>/g, "");
  stripped = stripped.replace(/\{[^}]+\}/g, "");
  return stripped.trim().length > 0;
}

function hasNonWhitespaceOutsidePhrasing(html: string): boolean {
  const tokens = html.split(/(<[^>]+>)/g);
  let textOutside = "";
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("<") && token.endsWith(">")) {
      if (token.startsWith("<!--")) continue;
      const isClosing = token.startsWith("</");
      const isSelfClosing = token.endsWith("/>");
      if (isSelfClosing) continue;
      const tagName = getTagName(token);
      if (isClosing) {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(tagName);
      }
    } else {
      if (stack.length === 0) {
        textOutside += token;
      }
    }
  }
  return textOutside.trim().length > 0;
}

export const INLINE_PHRASING_TAGS = new Set([
  "span",
  "code",
  "strong",
  "em",
  "a",
  "b",
  "i",
  "u",
  "mark",
  "small",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "abbr",
  "time",
  "q",
  "img",
  "br",
  "picture",
  "svg",
  "use",
  "path",
  "circle",
  "rect",
  "g",
  "defs",
  "symbol",
  "clippath",
  "mask",
  "pattern",
  "polygon",
  "polyline",
  "line",
  "ellipse",
  "text",
  "tspan",
  "stop",
  "lineargradient",
  "radialgradient",
  "image",
]);

function normalizeTags(html: string): {
  normalized: string;
  tagMap: TagMapEntry[];
  offsetMap: number[];
} {
  const tokens = html.split(/(<[^>]+>)/g);
  const tagMap: TagMapEntry[] = [];
  const distinctOpenTags: Record<string, string[]> = {};

  // First pass: collect distinct open tag configurations for inline phrasing tags
  for (const token of tokens) {
    const isTag = token.startsWith("<") && token.endsWith(">");
    if (isTag) {
      const isClosing = token.startsWith("</");
      const isComment = token.startsWith("<!--");
      if (!isComment && !isClosing) {
        const tagName = getTagName(token);
        if (INLINE_PHRASING_TAGS.has(tagName)) {
          if (!distinctOpenTags[tagName]) {
            distinctOpenTags[tagName] = [];
          }
          if (!distinctOpenTags[tagName].includes(token)) {
            distinctOpenTags[tagName].push(token);
          }
        }
      }
    }
  }

  // Second pass: construct normalized string, tagMap, and offsetMap
  const activeStacks: Record<string, number[]> = {};
  let normalized = "";
  const offsetMap: number[] = [];
  let origIdx = 0;

  for (const token of tokens) {
    const isTag = token.startsWith("<") && token.endsWith(">");
    if (isTag) {
      const isClosing = token.startsWith("</");
      const isComment = token.startsWith("<!--");
      if (isComment) {
        for (let i = 0; i < token.length; i++) {
          offsetMap.push(origIdx + i);
        }
        normalized += token;
      } else {
        const tagName = getTagName(token);
        if (INLINE_PHRASING_TAGS.has(tagName)) {
          const list = distinctOpenTags[tagName] || [];
          const totalConfigs = list.length;
          let normToken = "";
          if (isClosing) {
            if (totalConfigs > 1) {
              const stack = activeStacks[tagName] || [];
              const idx = stack.pop() || 1;
              normToken = `</${tagName}${idx}>`;
            } else {
              normToken = `</${tagName}>`;
            }
          } else {
            let alias = tagName;
            const isVoid = VOID_ELEMENTS.has(tagName) || token.endsWith("/>");
            if (totalConfigs > 1) {
              const idx = list.indexOf(token) + 1;
              if (!isVoid) {
                if (!activeStacks[tagName]) activeStacks[tagName] = [];
                activeStacks[tagName].push(idx);
              }
              alias = `${tagName}${idx}`;
            }
            normToken = isVoid ? `<${alias}/>` : `<${alias}>`;

            if (!tagMap.some((entry) => entry.alias === alias)) {
              tagMap.push({
                alias,
                originalOpen: token,
                tagName,
              });
            }
          }

          for (let i = 0; i < normToken.length; i++) {
            const origOffset =
              origIdx +
              Math.min(token.length - 1, Math.floor((i / normToken.length) * token.length));
            offsetMap.push(origOffset);
          }
          normalized += normToken;
        } else {
          for (let i = 0; i < token.length; i++) {
            offsetMap.push(origIdx + i);
          }
          normalized += token;
        }
      }
    } else {
      for (let i = 0; i < token.length; i++) {
        offsetMap.push(origIdx + i);
      }
      normalized += token;
    }
    origIdx += token.length;
  }

  offsetMap.push(origIdx);

  return { normalized, tagMap, offsetMap };
}

export class ExtractionContext {
  private _localBoundaries?: Map<string, string>;
  private _internalDeps?: Map<string, Set<string>>;
  private _exportedBoundaries?: Map<string, string>;
  public boundaryHashes: Record<string, string> = {};
  public trivias: Comment[] = [];

  public hasZintlMacro: boolean = false;
  public hasZintlMarker: boolean = false;
  public hasTopLevelAnchor: boolean = false;
  public isZeroConfig: boolean = true;
  public mode: "entry" | "boundary" = "boundary";
  public zintlImportGroup?: { start: number; end: number; source: string };
  public componentFunctions = new Set<number>();

  /**
   * Mark the enclosing function as a component, if it plausibly is one.
   *
   * "Contains JSX" is not the same as "is a component", and treating them as one
   * is how a hook ends up in a function that must not have one. The clearest
   * case is a bootstrap:
   *
   * ```tsx
   * async function bootstrap() {
   *   createRoot(el).render(<StrictMode><Main /></StrictMode>);
   * }
   * ```
   *
   * `bootstrap` is the outermost function containing JSX, so it was marked — and
   * injecting `useSyncExternalStore` there throws `Invalid hook call` and takes
   * the whole page down. That went unnoticed because the only consumer was gated
   * behind React Server Components' `"use client"` directive, which exactly one
   * file in this repository carries (ledger L-032).
   *
   * So require what React itself requires: a component's name is capitalised.
   * The name comes from the declaration, or from the binding an expression is
   * assigned to (`const App = () => …`). A function with no name at all is not
   * marked — an anonymous `export default () => …` is missed, which is the
   * conservative direction: failing to subscribe degrades a repaint, while
   * injecting a hook into a non-component breaks the application.
   */
  public registerComponentFunction(parents: Node[]) {
    const idx = parents.findIndex((p) =>
      ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(p.type),
    );
    if (idx === -1) return;

    const funcNode = parents[idx] as any;
    if (!funcNode.body || funcNode.body.type !== "BlockStatement") return;

    const name = funcNode.id?.name ?? (parents[idx - 1] as any)?.id?.name;
    if (typeof name !== "string" || !/^[A-Z]/.test(name)) return;

    this.componentFunctions.add(funcNode.body.start + 1);
  }

  private _rawSinks?: RawSink[];
  private _seenSinks?: Set<string>;
  public handledNodes: Set<number> = new Set();
  private _rawManualTranslations?: RawManualT[];

  private _messages?: Map<string, ExtractedMessage>;
  private _transforms?: Transform[];
  private _runtimeImports?: string[];
  private _usedKeys?: Set<string>;
  private _anchorSites?: AnchorSite[];
  private _dependencyPaths?: Map<string, boolean>;
  private _scopeBoundaries?: Map<number, string>;
  private _logicTaintedIdentifiers?: Set<string>;
  private _dependencyBindings?: Map<string, Set<string>>;

  public get messages() {
    return (this._messages ??= new Map());
  }
  public get transforms() {
    return (this._transforms ??= []);
  }
  public get runtimeImports() {
    return (this._runtimeImports ??= []);
  }
  public get usedKeys() {
    return (this._usedKeys ??= new Set());
  }
  public get anchorSites() {
    return (this._anchorSites ??= []);
  }
  public get dependencyPaths() {
    return (this._dependencyPaths ??= new Map());
  }
  public get scopeBoundaries() {
    return (this._scopeBoundaries ??= new Map());
  }
  public get logicTaintedIdentifiers() {
    return (this._logicTaintedIdentifiers ??= new Set());
  }
  public get dependencyBindings() {
    return (this._dependencyBindings ??= new Map());
  }
  public get localBoundaries() {
    return (this._localBoundaries ??= new Map());
  }
  public get internalDeps() {
    return (this._internalDeps ??= new Map());
  }
  public get exportedBoundaries() {
    return (this._exportedBoundaries ??= new Map());
  }
  public get rawSinks() {
    return (this._rawSinks ??= []);
  }
  public get rawManualTranslations() {
    return (this._rawManualTranslations ??= []);
  }
  private get seenSinks() {
    return (this._seenSinks ??= new Set());
  }

  public runtimePackage: string;
  public uiAttributes: Set<string>;
  public uiObjectFields: Set<string>;
  public uiSinkProperties: string[];
  /** @see CompiledExtractionState.domReceiverProperties */
  public uiSinkReceiverProperties: Map<string, Set<string>>;
  /** @see CompiledExtractionState.objectNameFields */
  public uiObjectNameFields: Map<string, Set<string>>;
  /** @see CompiledExtractionState.callFields */
  public uiCallFields: Map<string, Set<string>>;
  public jsxElementAttributes: Map<string, Set<string>>;
  public htmlAttributes: Set<string>;
  public targetPlugins: any[];
  public boundaryStack: { id: string; active: boolean }[];
  public logger: ZintlLogger;
  public isIgnoredFile = false;
  public suppressionLevel = 0;
  /**
   * Depth of enclosing `@zintl-target` regions.
   *
   * The mirror of {@link suppressionLevel}: inside one, every string field of
   * an object literal is a sink regardless of its name. A counter rather than a
   * boolean for the same reason — regions nest, and the inner one ending must
   * not end the outer.
   */
  public targetLevel = 0;
  /** Pre-built fast-path regex derived from the active target configuration. */
  public readonly fastPathRegex: RegExp;
  /** True when at least one dom:prop target is configured (e.g. innerHTML). */
  public readonly hasDomSinks: boolean;
  /** Identifiers whose tagged template literals hold markup — see `tag:`. */
  public readonly taggedTemplates: Set<string>;
  /** True when at least one `tag:` target is configured. */
  public readonly hasTaggedTemplateSinks: boolean;
  /** True when at least one jsx: target is configured. */
  public readonly hasJsxSinks: boolean;
  public readonly sfcRules: SfcRule[];
  public readonly suppressionRules: SuppressionRule[];
  public readonly mustacheRegex: RegExp | null;

  constructor(
    public code: string,
    public filePath: string,
    public fileBoundaryId: string,
    public options: ExtractionOptions = {},
  ) {
    this.logger = options.logger || defaultLogger;
    this.runtimePackage = options.runtimePackage || RUNTIME_PACKAGE;
    this.uiAttributes = options.uiAttributes ? new Set(options.uiAttributes) : new Set();
    this.uiObjectFields = options.uiObjectFields ? new Set(options.uiObjectFields) : new Set();
    this.uiSinkProperties = options.uiSinkProperties ? [...options.uiSinkProperties] : [];
    this.uiSinkReceiverProperties = new Map(
      options.uiSinkReceiverProperties
        ? [...options.uiSinkReceiverProperties].map(([k, v]) => [k, new Set(v)])
        : [],
    );
    this.uiObjectNameFields = new Map(
      options.uiObjectNameFields
        ? [...options.uiObjectNameFields].map(([k, v]) => [k, new Set(v)])
        : [],
    );
    this.uiCallFields = new Map(
      options.uiCallFields ? [...options.uiCallFields].map(([k, v]) => [k, new Set(v)]) : [],
    );
    this.jsxElementAttributes = new Map();
    this.htmlAttributes = new Set();
    this.targetPlugins = [];

    const compiledState = options.compiledState ?? resolveTargets(options.targets || []);
    options.compiledState = compiledState;

    for (const attr of compiledState.jsxAttributes) {
      this.uiAttributes.add(attr);
    }
    for (const field of compiledState.objectFields) {
      this.uiObjectFields.add(field);
    }
    for (const prop of compiledState.domProperties) {
      if (!this.uiSinkProperties.includes(prop)) {
        this.uiSinkProperties.push(prop);
      }
    }
    for (const [receiver, props] of compiledState.domReceiverProperties) {
      let existing = this.uiSinkReceiverProperties.get(receiver);
      if (!existing) {
        existing = new Set();
        this.uiSinkReceiverProperties.set(receiver, existing);
      }
      for (const prop of props) existing.add(prop);
    }
    for (const [binding, fields] of compiledState.objectNameFields) {
      let existing = this.uiObjectNameFields.get(binding);
      if (!existing) {
        existing = new Set();
        this.uiObjectNameFields.set(binding, existing);
      }
      for (const field of fields) existing.add(field);
    }
    for (const [fn, fields] of compiledState.callFields) {
      let existing = this.uiCallFields.get(fn);
      if (!existing) {
        existing = new Set();
        this.uiCallFields.set(fn, existing);
      }
      for (const field of fields) existing.add(field);
    }
    this.jsxElementAttributes = compiledState.jsxElementAttributes;
    this.htmlAttributes = compiledState.htmlAttributes;
    this.targetPlugins = compiledState.plugins;
    this.hasDomSinks = compiledState.hasDomSinks;
    this.taggedTemplates = compiledState.taggedTemplates ?? new Set();
    this.hasTaggedTemplateSinks = compiledState.hasTaggedTemplateSinks ?? false;
    this.hasJsxSinks = compiledState.hasJsxSinks;
    this.sfcRules = [...compiledState.sfcRules, ...(options.sfcRules || [])];
    this.suppressionRules = [
      ...compiledState.suppressionRules,
      ...(options.suppressionRules || []),
    ];
    let mustacheRegex = compiledState.mustacheRegex ?? null;
    if (!mustacheRegex && compiledState.mustacheRules) {
      const rule = compiledState.mustacheRules.find((r) =>
        r.extensions.some((ext) => filePath.endsWith(ext) || filePath.includes(ext + ".")),
      );
      if (rule) {
        mustacheRegex = rule.pattern;
      }
    }
    this.mustacheRegex = mustacheRegex;

    const extraHints = [
      ...(options.uiObjectFields || []),
      ...(options.uiSinkProperties || []),
      ...(options.uiAttributes || []),
    ];
    if (extraHints.length > 0) {
      const parts = [
        ...compiledState.fastPathRegex.source.split("|"),
        ...extraHints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      ];
      this.fastPathRegex = new RegExp(parts.join("|"));
    } else {
      this.fastPathRegex = compiledState.fastPathRegex;
    }

    this.isZeroConfig = options.isZeroConfig ?? true;
    this.boundaryStack = [{ id: fileBoundaryId, active: true }];
  }

  public getActiveBoundary() {
    return this.boundaryStack[this.boundaryStack.length - 1];
  }

  public pushSuppression(comments: { ignore?: boolean }) {
    if (comments.ignore) this.suppressionLevel++;
  }
  public popSuppression(comments: { ignore?: boolean }) {
    if (comments.ignore) this.suppressionLevel--;
  }

  public pushTarget(comments: { target?: boolean }) {
    if (comments.target) this.targetLevel++;
  }
  public popTarget(comments: { target?: boolean }) {
    if (comments.target) this.targetLevel--;
  }

  public addMessage(
    id: string,
    text: string,
    context: string,
    boundaryId: string,
    location: { line: number; column: number },
    variables: string[] = [],
    note?: string,
    sinkType?: string,
    passVars?: Record<string, string>,
  ) {
    const fullId = `${boundaryId}:${id}`;
    const existing = this.messages.get(fullId);
    if (existing) {
      if (context && !existing.contexts.includes(context)) existing.contexts.push(context);
      if (sinkType && !existing.sinkTypes.includes(sinkType)) existing.sinkTypes.push(sinkType);
    } else {
      this.messages.set(fullId, {
        id,
        text,
        contexts: context ? [context] : [],
        boundaryId,
        location,
        variables,
        note,
        sinkTypes: sinkType ? [sinkType] : [],
        passVars,
      });
    }
    this.usedKeys.add(fullId);
  }

  public addTransform(
    start: number,
    end: number,
    replacement: string,
    msgId?: string,
    boundaryId?: string,
    argNode?: Expression,
    originalText?: string,
  ) {
    this.transforms.push({
      start,
      end,
      replacement,
      msgId,
      boundaryId: boundaryId || this.getActiveBoundary().id,
      argNode,
      originalText,
    });
  }

  public addDependency(id: string, dynamic: boolean, bindings: string[] = []) {
    const depId = id.startsWith(".")
      ? join(dirname(this.fileBoundaryId), id).replace(/\\/g, "/")
      : id;
    const hasSourceExtension = /\.(tsx?|jsx?|mts|mjs|cts|cjs)$/i.test(depId);
    const cleanId = hasSourceExtension ? depId.replace(/\.[^/.]+$/, "") : depId;
    if (!this.dependencyPaths.has(cleanId)) this.dependencyPaths.set(cleanId, dynamic);
    else if (!dynamic) this.dependencyPaths.set(cleanId, false);
    if (bindings.length > 0) {
      if (!this.dependencyBindings.has(cleanId)) this.dependencyBindings.set(cleanId, new Set());
      for (const b of bindings) this.dependencyBindings.get(cleanId)!.add(b);
    }
  }

  public addInternalDependency(targetBoundaryId: string) {
    const current = this.getActiveBoundary().id;
    if (current === targetBoundaryId) return;
    if (!this.internalDeps.has(current)) this.internalDeps.set(current, new Set());
    this.internalDeps.get(current)!.add(targetBoundaryId);
  }

  public addRawSink(sink: RawSink) {
    const key = `${sink.boundaryId}:${sink.start}:${sink.end}:${sink.sinkType}`;
    if (this.seenSinks.has(key)) return;
    this.seenSinks.add(key);
    this.rawSinks.push(sink);
  }

  private pushNormalizedSource(source: LiteralSource, sources: LiteralSource[]) {
    if (source.variables?.length) {
      let counter = 1;
      const mapping: Record<string, string> = {},
        newVariables: string[] = [];
      let newText = source.text;
      const existingNames = new Set(source.variables.filter((v) => !/^var\d+$/.test(v)));
      for (const vName of source.variables) {
        if (/^var\d+$/.test(vName)) {
          let newName = counter === 1 ? "input" : `input${counter}`;
          while (existingNames.has(newName)) newName = `input${++counter}`;
          counter++;
          mapping[vName] = newName;
          newVariables.push(newName);
          newText = newText.replace(new RegExp(`\\{${vName}\\}`, "g"), `{${newName}}`);
        } else newVariables.push(vName);
      }
      source.text = newText;
      source.variables = newVariables;
      if (Object.keys(mapping).length) source.normalizedVariables = mapping;
    }
    sources.push(source);
  }

  public stitchHTML(
    text: string,
    onFragment: (
      t: string,
      n?: string,
      v?: Record<string, string>,
      s?: number,
      e?: number,
      tagMap?: TagMapEntry[],
    ) => void,
    initialNote?: string,
    initialPassVars: Record<string, string> = {},
    getOffsets?: (s: number, e: number) => { start: number; end: number },
  ) {
    const { normalized, tagMap, offsetMap } = normalizeTags(text);
    const tokens = normalized.split(/(<[^>]+>)/g);

    // Identify non-phrasing tokens or comments as partitions
    const isPartition = (t: string) => {
      if (t.startsWith("<") && t.endsWith(">")) {
        const isComment = t.startsWith("<!--");
        if (isComment) return false;
        const tagName = getTagName(t);
        const baseTagName = tagName.replace(/\d+$/, "");
        return !INLINE_PHRASING_TAGS.has(baseTagName);
      }
      return false;
    };

    const skipStitchTokenIndices = new Set<number>();

    // Group token indices into segments separated by partitions
    let currentSegment: number[] = [];
    const processSegment = (indices: number[]) => {
      if (indices.length === 0) return;
      const segmentStr = indices.map((idx) => tokens[idx]).join("");
      if (!hasNonWhitespaceOutsidePhrasing(segmentStr)) {
        for (const idx of indices) {
          const t = tokens[idx];
          if (t.startsWith("<") && t.endsWith(">") && !t.startsWith("<!--")) {
            skipStitchTokenIndices.add(idx);
          }
        }
      } else if (isSingleWrappingPhrasingTag(segmentStr)) {
        let openIdx = -1;
        let closeIdx = -1;
        for (const idx of indices) {
          const t = tokens[idx];
          if (
            t.startsWith("<") &&
            t.endsWith(">") &&
            !t.startsWith("<!--") &&
            !t.startsWith("</")
          ) {
            openIdx = idx;
            break;
          }
        }
        for (let i = indices.length - 1; i >= 0; i--) {
          const idx = indices[i];
          const t = tokens[idx];
          if (t.startsWith("</") && t.endsWith(">")) {
            closeIdx = idx;
            break;
          }
        }
        if (openIdx !== -1 && closeIdx !== -1) {
          skipStitchTokenIndices.add(openIdx);
          skipStitchTokenIndices.add(closeIdx);
        }
      }
    };

    for (let i = 0; i < tokens.length; i++) {
      if (isPartition(tokens[i])) {
        processSegment(currentSegment);
        currentSegment = [];
      } else {
        currentSegment.push(i);
      }
    }
    processSegment(currentSegment);

    let currentIdx = 0,
      pendingIgnore = false;
    const ignoreStack: string[] = [];
    let localNote = initialNote;
    const localPassVars = { ...initialPassVars };

    let buffer = "";
    let bufferStartIdx = 0;

    const flushBuffer = () => {
      if (buffer.trim() && hasTranslatableText(buffer)) {
        const trimmed = buffer.trim();
        const leadingWhitespaceLen = buffer.length - buffer.trimStart().length;
        const trailingWhitespaceLen = buffer.length - buffer.trimEnd().length;
        const sInNorm = bufferStartIdx + leadingWhitespaceLen;
        const eInNorm = currentIdx - trailingWhitespaceLen;

        const sInOrig = offsetMap[sInNorm];
        const eInOrig = offsetMap[eInNorm];

        const offsets = getOffsets?.(sInOrig, eInOrig);
        onFragment(
          trimmed,
          localNote,
          localPassVars,
          offsets?.start,
          offsets?.end,
          tagMap.length ? tagMap : undefined,
        );
        localNote = initialNote;
        for (const k in localPassVars) {
          if (!(k in initialPassVars)) delete localPassVars[k];
          else localPassVars[k] = initialPassVars[k];
        }
      }
      buffer = "";
      bufferStartIdx = 0;
    };

    let tokenIdx = 0;
    for (const token of tokens) {
      const isTag = token.startsWith("<") && token.endsWith(">");
      if (isTag) {
        const isClosing = token.startsWith("</"),
          isComment = token.startsWith("<!--"),
          tagName = isComment ? "" : getTagName(token);

        const directives = parseHTMLDirectives(token);

        if (isComment) {
          if (directives.ignore) {
            pendingIgnore = true;
          }
          if (directives.note) {
            localNote = directives.note;
          }
          Object.assign(localPassVars, directives.contextVars);
          currentIdx += token.length;
          tokenIdx++;
          continue;
        }

        const hasIgnore = directives.ignore || pendingIgnore || ignoreStack.length > 0;

        const baseTagName = tagName.replace(/\d+$/, "");
        let isPhrasing = INLINE_PHRASING_TAGS.has(baseTagName);
        if (skipStitchTokenIndices.has(tokenIdx) || hasIgnore) {
          isPhrasing = false;
        }

        if (isPhrasing && !isComment) {
          if (ignoreStack.length === 0 && !pendingIgnore) {
            if (buffer === "") {
              bufferStartIdx = currentIdx;
            }
            buffer += token;
          }
        } else {
          flushBuffer();

          // TODO: check this change (in case it broken, revert to the old code)
          // if (directives.ignore) {
          //   if (!isClosing && !token.endsWith("/>") && !VOID_ELEMENTS.has(tagName))
          //     ignoreStack.push(tagName);
          // } else if (pendingIgnore) {
          //   if (!isClosing && !token.endsWith("/>") && !VOID_ELEMENTS.has(tagName))
          //     ignoreStack.push(tagName);
          //   pendingIgnore = false;
          // }
          if (directives.ignore) {
            if (isComment) pendingIgnore = true;
            else if (!isClosing && !token.endsWith("/>") && !VOID_ELEMENTS.has(tagName))
              ignoreStack.push(tagName);
          } else if (pendingIgnore && !isComment) {
            if (!isClosing && !token.endsWith("/>") && !VOID_ELEMENTS.has(tagName))
              ignoreStack.push(tagName);
            pendingIgnore = false;
          }
          if (isClosing && ignoreStack.length && ignoreStack[ignoreStack.length - 1] === tagName)
            ignoreStack.pop();
          if (directives.note) localNote = directives.note;
          Object.assign(localPassVars, directives.contextVars);
        }
      } else {
        if (ignoreStack.length === 0 && !pendingIgnore) {
          if (buffer === "") {
            bufferStartIdx = currentIdx;
          }
          buffer += token;
        }
      }
      currentIdx += token.length;
      tokenIdx++;
    }

    flushBuffer();
  }

  public findLiteralsInExpression(
    node: Node,
    inheritedDirectives?: { note?: string; ignore?: boolean; contextVars: Record<string, string> },
    defaultContext?: string,
  ): LiteralSource[] {
    if (!node) return [];
    const comments = parseZintlComments(node.start, this.trivias, this.code);
    if (inheritedDirectives) {
      if (inheritedDirectives.note) comments.note = inheritedDirectives.note;
      if (inheritedDirectives.ignore) comments.ignore = true;
      Object.assign(comments.contextVars, inheritedDirectives.contextVars);
    }
    if (this.isIgnoredFile || this.suppressionLevel > 0 || comments.ignore) return [];

    const sources: LiteralSource[] = [];
    const isLit = (n: any) =>
      n.type === "StringLiteral" || (n.type === "Literal" && typeof n.value === "string");

    if (isLit(node)) {
      const text = (node as any).value as string;
      if (/<[^>]+>/.test(text)) {
        this.stitchHTML(
          text,
          (trimmed, note, passVars, start, end, tagMap) => {
            this.pushNormalizedSource(
              {
                node,
                text: trimmed,
                context: defaultContext || "Literal",
                location: { line: 0, column: 0 },
                variables: [],
                note,
                transformStart: start,
                transformEnd: end,
                inlineReplacement: true,
                passVars: Object.keys(passVars || {}).length ? { ...passVars } : undefined,
                tagMap,
              },
              sources,
            );
          },
          comments.note,
          comments.contextVars,
          (s, e) => ({ start: (node as any).start + 1 + s, end: (node as any).start + 1 + e }),
        );
        /**
         * Attributes, which `stitchHTML` does not read — it walks text nodes and
         * steps over tags. Registering them here is what makes an `alt` inside
         * `el.innerHTML = "…"` reach a catalog, the way the same `alt` in an HTML
         * document always has.
         *
         * The host is a plain string, so a `${…}` cannot be spliced into it until
         * the quotes become backticks — which is what `requiresQuoteConversion`
         * asks the pipeline to do.
         */
        scanTranslatableAttributes(
          text,
          this,
          this.getActiveBoundary().id,
          (i) => (node as any).start + 1 + i,
          {
            asFragment: true,
            host: {
              start: (node as any).start,
              end: (node as any).end,
              requiresQuoteConversion: true,
            },
          },
        );
      } else if ((node as any).value) {
        this.pushNormalizedSource(
          {
            node,
            text: (node as any).value,
            context: defaultContext || "Literal",
            location: { line: 0, column: 0 },
            passVars: Object.keys(comments.contextVars).length
              ? { ...comments.contextVars }
              : undefined,
          },
          sources,
        );
      }
    } else if (node.type === "TemplateLiteral") {
      let text = "";
      const variables: string[] = [],
        chunks: { isVar: boolean; text: string; sourceStart: number; sourceEnd: number }[] = [];
      for (let i = 0; i < node.quasis.length; i++) {
        const raw = node.quasis[i].value.raw;
        text += raw;
        chunks.push({
          isVar: false,
          text: raw,
          sourceStart: node.quasis[i].start + 1,
          sourceEnd: i === node.quasis.length - 1 ? node.quasis[i].end - 1 : node.quasis[i].end - 2,
        });
        if (i < node.expressions.length) {
          const expr = node.expressions[i];
          let vName = "var" + i;
          if (expr.type === "Identifier") vName = expr.name;
          else if (expr.type === "MemberExpression") {
            const parts: string[] = [];
            let curr: any = expr;
            while (
              curr &&
              curr.type === "MemberExpression" &&
              curr.property.type === "Identifier"
            ) {
              parts.unshift(curr.property.name);
              curr = curr.object;
            }
            if (curr && curr.type === "Identifier") {
              parts.unshift(curr.name);
              vName = parts.join("_");
            } else if (parts.length > 0) {
              vName = parts[parts.length - 1];
            }
          }
          const varFragment = `{${vName}}`;
          text += varFragment;
          variables.push(vName);
          chunks.push({
            isVar: true,
            text: varFragment,
            sourceStart: expr.start - 2,
            sourceEnd: expr.end + 1,
          });
        }
      }
      const getSourceIndex = (tIdx: number): number => {
        let curr = 0;
        for (const chunk of chunks) {
          if (tIdx === curr) return chunk.sourceStart;
          if (tIdx > curr && tIdx < curr + chunk.text.length) {
            if (chunk.isVar) throw new Error("Split inside variable");
            return chunk.sourceStart + (tIdx - curr);
          }
          curr += chunk.text.length;
        }
        return chunks[chunks.length - 1].sourceEnd;
      };
      if (/<[^>]+>/.test(text)) {
        this.stitchHTML(
          text,
          (trimmed, note, passVars, start, end, tagMap) => {
            if (
              trimmed.replace(/{[a-zA-Z0-9_]+}/g, "").trim() ||
              !!comments.note ||
              Object.keys(comments.contextVars).length
            ) {
              this.pushNormalizedSource(
                {
                  node,
                  text: trimmed,
                  context: defaultContext || "Template",
                  location: { line: 0, column: 0 },
                  variables: (trimmed.match(/{[a-zA-Z0-9_]+}/g) || []).map((v) => v.slice(1, -1)),
                  note,
                  transformStart: start,
                  transformEnd: end,
                  inlineReplacement: true,
                  passVars: Object.keys(passVars || {}).length ? { ...passVars } : undefined,
                  tagMap,
                },
                sources,
              );
            }
          },
          comments.note,
          comments.contextVars,
          (s, e) => ({ start: getSourceIndex(s), end: getSourceIndex(e) }),
        );
        /**
         * The same for a template literal, and the reason `getSourceIndex` is
         * handed over rather than a constant offset: it maps an index in the
         * stitched text back through the quasis, and *throws* for a range that
         * crosses an interpolation. The scanner reads that refusal as "skip this
         * one", which is how `src=${logo}` stays an expression rather than
         * becoming a translatable string.
         */
        scanTranslatableAttributes(text, this, this.getActiveBoundary().id, getSourceIndex, {
          asFragment: true,
          host: { start: (node as any).start, end: (node as any).end },
        });
      } else {
        const trimmed = text.trim();
        if (
          trimmed &&
          (trimmed.replace(/{[a-zA-Z0-9_]+}/g, "").trim() ||
            !!comments.note ||
            Object.keys(comments.contextVars).length)
        ) {
          this.pushNormalizedSource(
            {
              node,
              text: trimmed,
              context: defaultContext || "Template",
              location: { line: 0, column: 0 },
              variables,
              note: comments.note,
              passVars: Object.keys(comments.contextVars).length
                ? { ...comments.contextVars }
                : undefined,
            },
            sources,
          );
        }
      }
    } else if (node.type === "ConditionalExpression") {
      sources.push(
        ...this.findLiteralsInExpression(node.consequent, inheritedDirectives, defaultContext),
        ...this.findLiteralsInExpression(node.alternate, inheritedDirectives, defaultContext),
      );
    } else if (node.type === "BinaryExpression" && node.operator === "+") {
      sources.push(
        ...this.findLiteralsInExpression(node.left, inheritedDirectives, defaultContext),
        ...this.findLiteralsInExpression(node.right, inheritedDirectives, defaultContext),
      );
    } else if (node.type === "LogicalExpression") {
      sources.push(
        ...this.findLiteralsInExpression(node.left, inheritedDirectives, defaultContext),
        ...this.findLiteralsInExpression(node.right, inheritedDirectives, defaultContext),
      );
    } else if (node.type === "ObjectExpression") {
      node.properties.forEach((prop) => {
        if (prop.type === "Property") {
          const key =
            prop.key.type === "Identifier"
              ? prop.key.name
              : (prop.key.type as string) === "StringLiteral"
                ? (prop.key as any).value
                : "";
          if (key)
            this.findLiteralsInExpression(prop.value, inheritedDirectives).forEach((s) => {
              s.context = s.context === "Literal" ? key : `${key}.${s.context}`;
              sources.push(s);
            });
        }
      });
    }
    return sources;
  }

  private sha1(content: string) {
    return createHash("sha1").update(content).digest("hex");
  }

  public computeBoundaryHashes(): Record<string, string> {
    const hashes: Record<string, string> = {},
      allBIds = new Set<string>();
    if (this._messages) for (const msg of this._messages.values()) allBIds.add(msg.boundaryId);
    for (const b of this.boundaryStack) allBIds.add(b.id);
    if (this._anchorSites) for (const site of this._anchorSites) allBIds.add(site.boundaryId);
    for (const bId of allBIds) {
      if (this.boundaryHashes[bId]) hashes[bId] = this.boundaryHashes[bId];
      else hashes[bId] = this.boundaryHashes[bId] = "b_" + this.sha1(bId).substring(0, 12);
    }
    return hashes;
  }
}
