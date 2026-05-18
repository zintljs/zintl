import type {
  Node,
  ImportDeclaration,
  ImportExpression,
  AssignmentExpression,
  TemplateLiteral,
  ObjectProperty as Property,
} from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { generateMessageId } from "../hashing.js";
import { DEFAULT_UI_SINK_PROPERTIES } from "../constants.js";
import { getAttachedComments } from "../comments.js";
import type { LiteralSource, RawVariable } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveBoundaryId(ctx: ExtractionContext, sourcePath: string): string | null {
  const isRelative = sourcePath.startsWith("./") || sourcePath.startsWith("../");

  if (!isRelative && !sourcePath.match(/\.(ts|tsx|js|jsx)$/) && sourcePath.includes(".")) {
    return null;
  }
  if (isRelative && sourcePath.match(/\.(css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf)$/i)) {
    return null;
  }

  const currentDir = ctx.fileBoundaryId.includes("/")
    ? ctx.fileBoundaryId.substring(0, ctx.fileBoundaryId.lastIndexOf("/"))
    : "";

  let resolved = sourcePath;
  if (sourcePath.startsWith("./")) {
    const name = sourcePath.substring(2);
    resolved = currentDir ? `${currentDir}/${name}` : name;
  } else if (sourcePath.startsWith("../")) {
    const depth = (sourcePath.match(/\.\.\//g) || []).length;
    const parts = currentDir.split("/").filter(Boolean);
    const up = Math.max(0, parts.length - depth);
    const name = sourcePath.replace(/\.\.\//g, "");
    const base = parts.slice(0, up).join("/");
    resolved = base ? `${base}/${name}` : name;
  }

  return resolved.replace(/\.(tsx?|jsx?|vue)$/, "");
}

function extractRawVariables(source: LiteralSource, ctx: ExtractionContext): RawVariable[] {
  if (!source.variables?.length || source.node.type !== "TemplateLiteral") return [];

  const node = source.node as TemplateLiteral;
  const variables: RawVariable[] = [];

  node.expressions.forEach((expr: any, i: number) => {
    const vName = resolveExpressionName(expr, i);
    const finalName = source.normalizedVariables?.[vName] ?? vName;
    const withinRange =
      !source.transformStart ||
      (expr.start >= source.transformStart &&
        source.transformEnd !== undefined &&
        expr.end <= source.transformEnd);

    if (source.variables!.includes(finalName) && withinRange) {
      variables.push({
        name: finalName,
        originalName: vName,
        expression: ctx.code.slice(expr.start, expr.end),
        start: expr.start,
        end: expr.end,
      });
    }
  });

  return variables;
}

/** Infer a readable variable name from a template expression node. */
function resolveExpressionName(expr: any, index: number): string {
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberExpression") {
    const parts: string[] = [];
    let curr: any = expr;
    while (curr && curr.type === "MemberExpression" && curr.property.type === "Identifier") {
      parts.unshift(curr.property.name);
      curr = curr.object;
    }
    if (curr && curr.type === "Identifier") {
      parts.unshift(curr.name);
      return parts.join("_");
    } else if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return `var${index}`;
}

// ─── Core sink processor ────────────────────────────────────────────────────

/**
 * Process a single literal source found on a UI sink property.
 * Registers the message, records the raw sink, and queues the code transform.
 */
function processSinkSource(
  source: LiteralSource,
  sinkType: string,
  boundaryId: string,
  parentStart: number,
  ctx: ExtractionContext,
): void {
  const msgId = generateMessageId(source.text, source.context, source.note);
  ctx.addMessage(
    msgId,
    source.text,
    source.context,
    boundaryId,
    source.location,
    source.variables,
    source.note,
    sinkType,
    source.passVars,
  );

  const rawVars = extractRawVariables(source, ctx);
  const isFragment = !!source.inlineReplacement;
  const requiresQuoteConversion = isFragment && source.node.type === ("StringLiteral" as any);

  ctx.addRawSink({
    text: source.text,
    sinkType,
    start: isFragment ? source.transformStart! : source.node.start,
    end: isFragment ? source.transformEnd! : source.node.end,
    line: source.location.line,
    column: source.location.column,
    boundaryId,
    variables: rawVars,
    note: source.note,
    passVars: source.passVars,
    isFragment,
    fragmentStart: isFragment ? source.transformStart : undefined,
    fragmentEnd: isFragment ? source.transformEnd : undefined,
    hostStart: isFragment ? (source.node as any).start : undefined,
    hostEnd: isFragment ? (source.node as any).end : undefined,
    requiresQuoteConversion,
    tagMap: source.tagMap,
  });

  // No-op: Transformations are now handled by the Pipeline during Phase 3/4
  // using the data collected in addRawSink.
}

// ─── Visitor ────────────────────────────────────────────────────────────────

export function createBindingVisitor(_ctx: ExtractionContext) {
  return {
    ImportDeclaration(node: ImportDeclaration, ctx: ExtractionContext) {
      if (node.source.type !== ("StringLiteral" as any) && node.source.type !== ("Literal" as any))
        return;
      const sourceVal = (node.source as any).value;

      if (sourceVal === ctx.runtimePackage || sourceVal === "zintl/internal") {
        node.specifiers?.forEach((spec: any) => {
          if (spec.type === "ImportSpecifier" && spec.imported.type === "Identifier") {
            ctx.runtimeImports.push(spec.imported.name);
          }
        });
      } else if (sourceVal.startsWith(".")) {
        const resolved = resolveBoundaryId(ctx, sourceVal);
        if (resolved !== null) {
          const bindings: string[] = [];
          node.specifiers?.forEach((spec: any) => {
            if (spec.type === "ImportSpecifier") {
              const name = (spec.imported as any).name || (spec.imported as any).value;
              if (name) bindings.push(name);
            } else if (spec.type === "ImportDefaultSpecifier") {
              bindings.push("default");
            }
          });
          ctx.addDependency(sourceVal, false, bindings);
        }
      }
    },

    ImportExpression(node: ImportExpression, ctx: ExtractionContext) {
      const src = node.source as any;
      if ((src.type === "StringLiteral" || src.type === "Literal") && src.value.startsWith(".")) {
        const resolved = resolveBoundaryId(ctx, src.value);
        if (resolved !== null && !ctx.dependencyPaths.has(resolved)) {
          ctx.dependencyPaths.set(resolved, true);
        }
      }
    },

    AssignmentExpression(node: AssignmentExpression, ctx: ExtractionContext, parents: Node[]) {
      if (ctx.suppressionLevel > 0) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active || node.left.type !== "MemberExpression") return;

      const prop =
        (node.left as any).property.type === "Identifier" ? (node.left as any).property.name : "";

      if (!DEFAULT_UI_SINK_PROPERTIES.includes(prop)) return;

      const stmtComments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      const sources = ctx.findLiteralsInExpression(node.right as Node, stmtComments, prop);

      sources.forEach((source) =>
        processSinkSource(source, prop, boundaryId, parents[0]?.start ?? node.start, ctx),
      );
    },

    Property(node: Property, ctx: ExtractionContext, parents: Node[]) {
      if (ctx.suppressionLevel > 0) return;
      if (ctx.handledNodes.has(node.start)) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active) return;

      const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      if (comments.ignore) return;

      const keyName =
        node.key.type === "Identifier"
          ? (node.key as any).name
          : node.key.type === ("StringLiteral" as any) || node.key.type === ("Literal" as any)
            ? (node.key as any).value
            : "";

      if (!ctx.uiObjectFields.has(keyName)) return;

      const stmtComments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      const sources = ctx.findLiteralsInExpression(node.value as Node, stmtComments, keyName);

      sources.forEach((source) =>
        processSinkSource(source, keyName, boundaryId, parents[0]?.start ?? node.start, ctx),
      );
    },

    VariableDeclaration: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) {
          ctx.suppressionLevel++;
        }
      },
      exit(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) {
          ctx.suppressionLevel--;
        }
      },
    },
  };
}
