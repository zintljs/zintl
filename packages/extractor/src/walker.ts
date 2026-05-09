import type { Node } from "@oxc-project/types";
import { ExtractionContext } from "./context.js";

type VisitorFn = (node: Node, ctx: ExtractionContext, parents: Node[]) => void;

export interface Visitor {
  enter?: VisitorFn;
  exit?: VisitorFn;
}

export type Visitors = Record<string, Visitor | VisitorFn>;

export function walk(node: Node, visitors: Visitors, ctx: ExtractionContext, parents: Node[] = []) {
  if (!node || typeof node !== "object") return;

  if (ctx.isIgnoredFile) return;
  const type = node.type;
  if (ctx.handledNodes.has(node.start)) return;

  const visitor = visitors[type];

  if (visitor) {
    try {
      if (typeof visitor === "function") {
        visitor(node, ctx, parents);
      } else if (visitor.enter) {
        visitor.enter(node, ctx, parents);
      }
    } catch (e: any) {
      ctx.logger.error(`ERROR in visitor [${type}] at offset ${node.start}:`, e);
      throw e;
    }
  }

  // Recurse into children
  const nextParents = [node, ...parents];

  // OPTIMIZATION: Avoid expensive for...in reflection for common OXC nodes.
  // We use a specialized lookup for properties known to contain child nodes.
  const type_ = node.type;
  if (type_ === "Program") {
    for (const stmt of (node as any).body) {
      walk(stmt, visitors, ctx, nextParents);
    }
  } else if (type_ === "JSXElement") {
    // Walk opening element, children, and closing element
    walk((node as any).openingElement, visitors, ctx, nextParents);
    for (const child of (node as any).children) {
      walk(child, visitors, ctx, nextParents);
    }
    if ((node as any).closingElement) {
      walk((node as any).closingElement, visitors, ctx, nextParents);
    }
  } else if (type_ === "JSXOpeningElement") {
    walk((node as any).name, visitors, ctx, nextParents);
    for (const attr of (node as any).attributes) {
      walk(attr, visitors, ctx, nextParents);
    }
  } else if (type_ === "JSXAttribute") {
    if ((node as any).value) walk((node as any).value, visitors, ctx, nextParents);
  } else if (type_ === "JSXExpressionContainer") {
    walk((node as any).expression, visitors, ctx, nextParents);
  } else if (
    type_ === "FunctionDeclaration" ||
    type_ === "FunctionExpression" ||
    type_ === "ArrowFunctionExpression"
  ) {
    if ((node as any).id) walk((node as any).id, visitors, ctx, nextParents);
    const params = (node as any).params?.items || (node as any).params || [];
    for (const param of params) {
      walk(param, visitors, ctx, nextParents);
    }
    walk((node as any).body, visitors, ctx, nextParents);
  } else if (type_ === "BlockStatement") {
    for (const stmt of (node as any).body) {
      walk(stmt, visitors, ctx, nextParents);
    }
  } else if (type_ === "CallExpression") {
    walk((node as any).callee, visitors, ctx, nextParents);
    for (const arg of (node as any).arguments) {
      walk(arg, visitors, ctx, nextParents);
    }
  } else if (type_ === "ExpressionStatement") {
    walk((node as any).expression, visitors, ctx, nextParents);
  } else if (type_ === "VariableDeclaration") {
    for (const decl of (node as any).declarations) {
      walk(decl, visitors, ctx, nextParents);
    }
  } else if (type_ === "VariableDeclarator") {
    walk((node as any).id, visitors, ctx, nextParents);
    if ((node as any).init) walk((node as any).init, visitors, ctx, nextParents);
  } else if (type_ === "ReturnStatement") {
    if ((node as any).argument) walk((node as any).argument, visitors, ctx, nextParents);
  } else {
    // Fallback for less common nodes
    for (const key in node) {
      if (key === "parent") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && item.type) {
            walk(item, visitors, ctx, nextParents);
          }
        }
      } else if (child && typeof child === "object" && child.type) {
        walk(child, visitors, ctx, nextParents);
      }
    }
  }

  if (visitor && typeof visitor !== "function" && visitor.exit) {
    visitor.exit(node, ctx, parents);
  }
}
