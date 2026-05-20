import type { Node } from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { createJsxVisitor } from "./jsx.js";
import { createBindingVisitor } from "./bindings.js";
import { createProgramVisitor } from "./program.js";
import { Visitors, Visitor } from "../walker.js";

export function createCombinedVisitor(ctx: ExtractionContext): Visitors {
  // Check for file-level ignore directive
  for (const trivia of ctx.trivias) {
    if (trivia.value.includes("@zintl-ignore-file")) {
      ctx.isIgnoredFile = true;
      break;
    }
  }

  // Heuristic: If there are no strings, no JSX, and no t() calls, we can skip the heavy visitors.
  // This is safe because sinks and messages ALWAYS require a string literal or JSX element.
  const hasMaybeUI = /['"`]|<|zintl|t\(|innerHTML/.test(ctx.code);

  const visitors = hasMaybeUI
    ? [createJsxVisitor(ctx), createBindingVisitor(ctx), createProgramVisitor(ctx)]
    : [createProgramVisitor(ctx)];

  if ((ctx as any).targetPlugins) {
    for (const plugin of (ctx as any).targetPlugins) {
      if (plugin.createVisitor) {
        visitors.push(plugin.createVisitor(ctx));
      }
    }
  }

  const combined: Visitors = {};

  for (const visitor of visitors) {
    for (const [key, value] of Object.entries(visitor)) {
      if (!combined[key]) {
        combined[key] = value as any;
        continue;
      }

      const existing = combined[key];
      const next = value as any;

      combined[key] = {
        enter(node: Node, ctx: ExtractionContext, parents: Node[]) {
          if (typeof existing === "function") {
            existing(node, ctx, parents);
          } else if ((existing as Visitor).enter) {
            (existing as Visitor).enter!(node, ctx, parents);
          }

          if (typeof next === "function") {
            next(node, ctx, parents);
          } else if ((next as Visitor).enter) {
            (next as Visitor).enter!(node, ctx, parents);
          }
        },
        exit(node: Node, ctx: ExtractionContext, parents: Node[]) {
          if (typeof existing !== "function" && (existing as Visitor).exit) {
            (existing as Visitor).exit!(node, ctx, parents);
          }
          if (typeof next !== "function" && (next as Visitor).exit) {
            (next as Visitor).exit!(node, ctx, parents);
          }
        },
      };
    }
  }

  return combined;
}
