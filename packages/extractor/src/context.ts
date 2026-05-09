import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Node, Expression } from "@oxc-project/types";
import type { Comment } from "oxc-parser";
import { DEFAULT_UI_ATTRIBUTES, DEFAULT_UI_OBJECT_FIELDS, RUNTIME_PACKAGE } from "./constants.js";
import {
  ExtractedMessage,
  ExtractionOptions,
  Transform,
  LiteralSource,
  AnchorSite,
  RawSink,
  RawManualT,
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
  public boundaryStack: { id: string; active: boolean }[];
  public logger: ZintlLogger;
  public isIgnoredFile = false;
  public suppressionLevel = 0;

  constructor(
    public code: string,
    public filePath: string,
    public fileBoundaryId: string,
    public options: ExtractionOptions = {},
  ) {
    this.logger = options.logger || defaultLogger;
    this.runtimePackage = options.runtimePackage || RUNTIME_PACKAGE;
    this.uiAttributes = options.uiAttributes || DEFAULT_UI_ATTRIBUTES;
    this.uiObjectFields = options.uiObjectFields || DEFAULT_UI_OBJECT_FIELDS;
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
    const cleanId = depId.replace(/\.[^/.]+$/, "");
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

  private stitchHTML(
    text: string,
    onFragment: (t: string, n?: string, v?: Record<string, string>, s?: number, e?: number) => void,
    initialNote?: string,
    initialPassVars: Record<string, string> = {},
    getOffsets?: (s: number, e: number) => { start: number; end: number },
  ) {
    const tokens = text.split(/(<[^>]+>)/g);
    let currentIdx = 0,
      pendingIgnore = false;
    const ignoreStack: string[] = [];
    let localNote = initialNote;
    const localPassVars = { ...initialPassVars };

    for (const token of tokens) {
      const isTag = token.startsWith("<") && token.endsWith(">");
      if (isTag) {
        const isClosing = token.startsWith("</"),
          isComment = token.startsWith("<!--"),
          tagName = isComment ? "" : getTagName(token);
        const directives = parseHTMLDirectives(token);
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
      } else {
        if (ignoreStack.length === 0 && !pendingIgnore && token.trim()) {
          const trimmed = token.trim(),
            sInT = currentIdx + token.indexOf(trimmed),
            eInT = sInT + trimmed.length,
            offsets = getOffsets?.(sInT, eInT);
          onFragment(trimmed, localNote, localPassVars, offsets?.start, offsets?.end);
          localNote = initialNote;
          for (const k in localPassVars)
            if (!(k in initialPassVars)) delete localPassVars[k];
            else localPassVars[k] = initialPassVars[k];
        }
      }
      currentIdx += token.length;
    }
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
          (trimmed, note, passVars, start, end) => {
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
              },
              sources,
            );
          },
          comments.note,
          comments.contextVars,
          (s, e) => ({ start: (node as any).start + 1 + s, end: (node as any).start + 1 + e }),
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
          (trimmed, note, passVars, start, end) => {
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
                },
                sources,
              );
            }
          },
          comments.note,
          comments.contextVars,
          (s, e) => ({ start: getSourceIndex(s), end: getSourceIndex(e) }),
        );
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
