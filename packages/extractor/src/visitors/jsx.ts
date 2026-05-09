import type {
  Node,
  JSXElement,
  JSXFragment,
  JSXText,
  JSXAttribute,
  JSXExpressionContainer,
} from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { generateMessageId } from "../hashing.js";
import { getAttachedComments, parseZintlComments } from "../comments.js";
import type { RawVariable } from "../types.js";

function processJsxChildren(node: JSXElement | JSXFragment, ctx: ExtractionContext) {
  if (ctx.suppressionLevel > 0) return;
  const { id: boundaryId, active } = ctx.getActiveBoundary();
  if (!active) return;

  const children = node.children;
  if (!children?.length) return;

  const comments = parseZintlComments(node.start, ctx.trivias, ctx.code);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression") {
      const childComments = parseZintlComments(child.expression.start, ctx.trivias, ctx.code);
      if (childComments.ignore) {
        for (let j = i + 1; j < children.length; j++) {
          const nextChild = children[j];
          if (nextChild.type === "JSXText" && !nextChild.value.trim()) continue;
          ctx.handledNodes.add(nextChild.start);
          break;
        }
      }
      if (childComments.note) comments.note = childComments.note;
      Object.assign(comments.contextVars, childComments.contextVars);
    }
  }

  if (comments.ignore) return;

  const hasDirectives = !!comments.note || Object.keys(comments.contextVars).length > 0;
  if (!children.some((c) => c.type === "JSXText" && c.value.trim()) && !hasDirectives) return;
  if (children.some((c) => c.type === "JSXElement" || c.type === "JSXFragment")) return;

  let text = "",
    variables: string[] = [],
    pairs: string[] = [];

  for (const child of children) {
    if (child.type === "JSXText") {
      text += child.value;
      ctx.handledNodes.add(child as any);
    } else if (child.type === "JSXExpressionContainer") {
      const expr = child.expression;
      if (expr.type === "JSXEmptyExpression") continue;

      let vName = `var${variables.length}`;
      if (expr.type === "Identifier") vName = expr.name;
      else if (expr.type === "MemberExpression") {
        const parts: string[] = [];
        let curr: any = expr;
        while (curr && curr.type === "MemberExpression" && curr.property.type === "Identifier") {
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
      if (/^var\d+$/.test(vName))
        vName = variables.length === 0 ? "input" : `input${variables.length + 1}`;

      text += `{${vName}}`;
      variables.push(vName);
      pairs.push(`${vName}: ${ctx.code.slice(expr.start, expr.end)}`);
      ctx.handledNodes.add(child as any);
    }
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!text) return;

  const context =
    (node as any).openingElement?.name?.type === "JSXIdentifier"
      ? (node as any).openingElement.name.name
      : "";
  const id = generateMessageId(text, context, comments.note);

  ctx.addMessage(
    id,
    text,
    context,
    boundaryId,
    { line: 0, column: 0 },
    variables,
    comments.note,
    undefined,
    Object.keys(comments.contextVars).length ? comments.contextVars : undefined,
  );

  const start = children[0].start,
    end = children[children.length - 1].end;
  const exprNodes = children
    .filter(
      (c: any) => c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression",
    )
    .map((c: any) => c.expression);

  ctx.addRawSink({
    text,
    sinkType: context,
    start,
    end,
    line: 0,
    column: 0,
    boundaryId,
    isFragment: false,
    note: comments.note,
    variables: pairs.map((pair, i) => ({
      name: pair.split(":")[0].trim(),
      originalName: pair.split(":")[0].trim(),
      expression: pair.split(":")[1].trim(),
      start: exprNodes[i]?.start ?? 0,
      end: exprNodes[i]?.end ?? 0,
    })),
    passVars: Object.keys(comments.contextVars).length ? comments.contextVars : undefined,
  });
}

export function createJsxVisitor(_ctx: ExtractionContext) {
  return {
    JSXElement: {
      enter(node: JSXElement, ctx: ExtractionContext) {
        if (ctx.handledNodes.has(node.start)) return;
        const comments = parseZintlComments(node.start, ctx.trivias, ctx.code);
        if (comments.ignore) {
          ctx.pushSuppression(comments);
          return;
        }
        processJsxChildren(node, ctx);
      },
      exit(node: JSXElement, ctx: ExtractionContext) {
        ctx.popSuppression(parseZintlComments(node.start, ctx.trivias, ctx.code));
      },
    },
    JSXFragment: {
      enter(node: JSXFragment, ctx: ExtractionContext) {
        if (ctx.handledNodes.has(node.start)) return;
        const comments = parseZintlComments(node.start, ctx.trivias, ctx.code);
        if (comments.ignore) {
          ctx.pushSuppression(comments);
          return;
        }
        processJsxChildren(node, ctx);
      },
      exit(node: JSXFragment, ctx: ExtractionContext) {
        ctx.popSuppression(parseZintlComments(node.start, ctx.trivias, ctx.code));
      },
    },
    JSXText(node: JSXText, ctx: ExtractionContext, parents: Node[]) {
      if (ctx.suppressionLevel > 0 || ctx.handledNodes.has(node as any)) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active) return;
      const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      if (comments.ignore) return;
      const text = node.value.trim();
      if (!text) return;
      const context = (parents[0] as any)?.openingElement?.name?.name || "";
      ctx.addMessage(
        generateMessageId(text, context, comments.note),
        text,
        context,
        boundaryId,
        { line: 0, column: 0 },
        [],
        comments.note,
        undefined,
        Object.keys(comments.contextVars).length ? comments.contextVars : undefined,
      );
      ctx.addRawSink({
        text,
        sinkType: context,
        start: node.start,
        end: node.end,
        line: 0,
        column: 0,
        boundaryId,
        variables: [],
        note: comments.note,
        passVars: Object.keys(comments.contextVars).length ? comments.contextVars : undefined,
        isFragment: false,
      });
    },
    JSXAttribute: {
      enter(node: JSXAttribute, ctx: ExtractionContext, parents: Node[]) {
        if (ctx.suppressionLevel > 0 || ctx.handledNodes.has(node.start)) return;
        const { id: boundaryId, active } = ctx.getActiveBoundary();
        if (!active) return;
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) {
          ctx.pushSuppression(comments);
          return;
        }
        const attrName = node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (
          ctx.uiAttributes.has(attrName) &&
          (node.value?.type === ("StringLiteral" as any) || node.value?.type === ("Literal" as any))
        ) {
          const text = (node.value as any).value;
          ctx.addMessage(generateMessageId(text, attrName), text, attrName, boundaryId, {
            line: 0,
            column: 0,
          });
          ctx.addRawSink({
            text,
            sinkType: attrName,
            start: (node.value as any).start,
            end: (node.value as any).end,
            line: 0,
            column: 0,
            boundaryId,
            variables: [],
            isFragment: false,
          });
        }
      },
      exit(node: JSXAttribute, ctx: ExtractionContext, parents: Node[]) {
        ctx.popSuppression(getAttachedComments(node, parents, ctx.trivias, ctx.code));
      },
    },
    JSXExpressionContainer(node: JSXExpressionContainer, ctx: ExtractionContext, parents: Node[]) {
      if (ctx.suppressionLevel > 0 || ctx.handledNodes.has(node as any)) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active) return;
      const expr = node.expression;
      if (
        expr.type !== "Identifier" &&
        !(
          expr.type === "MemberExpression" &&
          (expr as any).object.type === "Identifier" &&
          (expr as any).property.type === "Identifier"
        )
      ) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        if (comments.ignore) return;
        ctx.findLiteralsInExpression(expr as Node, comments).forEach((source) => {
          const id = generateMessageId(source.text, source.context, source.note);
          ctx.addMessage(
            id,
            source.text,
            source.context,
            boundaryId,
            source.location,
            source.variables,
            source.note,
            undefined,
            source.passVars,
          );
          const rawVars: RawVariable[] = [];
          if (source.variables?.length && source.node.type === "TemplateLiteral") {
            (source.node as any).expressions.forEach((e: any, i: number) => {
              const vName = e.type === "Identifier" ? e.name : "var" + i;
              const finalName =
                (source.normalizedVariables && source.normalizedVariables[vName]) || vName;
              if (source.variables!.includes(finalName))
                rawVars.push({
                  name: finalName,
                  originalName: vName,
                  expression: ctx.code.slice(e.start, e.end),
                  start: e.start,
                  end: e.end,
                });
            });
          }
          ctx.addRawSink({
            text: source.text,
            sinkType: source.context,
            start: source.node.start,
            end: source.node.end,
            line: source.location.line,
            column: source.location.column,
            boundaryId,
            variables: rawVars,
            isFragment: false,
            note: source.note,
            passVars: source.passVars,
          });
        });
      }
    },
  };
}
