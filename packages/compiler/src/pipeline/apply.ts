/**
 * @module pipeline/apply
 *
 * Phase 4: APPLY — Mutation Phase
 *
 * "Actually touch the AST / Source Code"
 *
 * This phase performs the mechanical code surgery using MagicString.
 * It follows the ResolvedPlan precisely and makes zero decisions.
 */

import MagicString from "magic-string";
import type { ResolvedPlan, TransformResult, ApplyFn, ZintlLogger } from "./types.js";

/**
 * Apply a resolved transformation plan to source code.
 */
export const apply: ApplyFn = (
  source: string,
  plan: ResolvedPlan,
  logger: ZintlLogger,
): TransformResult => {
  logger.debug("Applying transformation plan...");
  const ms = new MagicString(source);
  const diagnostics = [...plan.diagnostics];

  // 1. Apply Prepends (Managers)
  // These go at the very top of the file
  for (const prepend of plan.prepends) {
    ms.prepend(prepend.code + "\n");
  }

  // 2. Apply Imports
  for (const imp of plan.imports) {
    try {
      if (imp.strategy === "new") {
        ms.prepend(`import { ${imp.specifiers.join(", ")} } from "${imp.source}";\n`);
      } else if (imp.strategy === "replace" && imp.location) {
        if (imp.location.start === imp.location.end) {
          ms.appendLeft(
            imp.location.start,
            `import { ${imp.specifiers.join(", ")} } from "${imp.source}";`,
          );
        } else {
          ms.overwrite(
            imp.location.start,
            imp.location.end,
            `import { ${imp.specifiers.join(", ")} } from "${imp.source}";`,
          );
        }
      } else if (imp.strategy === "merge" && imp.location) {
        const end = imp.location.end;
        const closingBrace = source.lastIndexOf("}", end);
        if (closingBrace !== -1) {
          const contentBeforeBrace = source.substring(0, closingBrace);
          const trimmedBefore = contentBeforeBrace.trimEnd();
          const needsComma = !trimmedBefore.endsWith("{") && !trimmedBefore.endsWith(",");
          const prefix = needsComma ? ", " : "";
          ms.appendLeft(trimmedBefore.length, `${prefix}${imp.specifiers.join(", ")}`);
          if (trimmedBefore === contentBeforeBrace) {
            ms.appendLeft(closingBrace, " ");
          }
        } else {
          if (imp.location.start === imp.location.end) {
            ms.appendLeft(
              imp.location.start,
              `import { ${imp.specifiers.join(", ")} } from "${imp.source}";`,
            );
          } else {
            ms.overwrite(
              imp.location.start,
              imp.location.end,
              `import { ${imp.specifiers.join(", ")} } from "${imp.source}";`,
            );
          }
        }
      }
    } catch (err: any) {
      console.error(
        `MagicString import strategy failed: strategy=${imp.strategy}, start=${imp.location?.start}, end=${imp.location?.end}, sourceLength=${source.length}`,
      );
      throw err;
    }
  }

  // 3. Apply Rewrites
  for (const rewrite of plan.rewrites) {
    if (rewrite.start === rewrite.end) {
      try {
        ms.appendLeft(rewrite.start, rewrite.replacement);
      } catch (err: any) {
        console.error(
          `MagicString.appendLeft failed: start=${rewrite.start}, sourceLength=${source.length}, replacement=${rewrite.replacement}`,
        );
        throw err;
      }
    } else {
      try {
        ms.overwrite(rewrite.start, rewrite.end, rewrite.replacement);
      } catch (err: any) {
        console.error(
          `MagicString.overwrite failed: start=${rewrite.start}, end=${rewrite.end}, sourceLength=${source.length}, replacement=${rewrite.replacement}`,
        );
        console.error(`Full Plan Rewrites:`, JSON.stringify(plan.rewrites, null, 2));
        throw err;
      }
    }
  }

  const code = ms.toString();
  return {
    code,
    map: ms.generateMap({ hires: true }),
    diagnostics,
  };
};
