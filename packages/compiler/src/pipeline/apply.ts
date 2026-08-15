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
import type {
  ResolvedPlan,
  TransformResult,
  ApplyFn,
  ZintlLogger,
  ZintlConfig,
} from "../types/index.js";

/**
 * Rewrite kinds whose replacement references a binding Zintl injects into the
 * SFC's script block — `_t` and the `_zintl_mgr_*` manager imports.
 *
 * `bake` and `quote_convert` substitute a literal and reference nothing, which
 * is why a baked build of an Options-API component is correct today and must
 * stay buildable. See {@link refuseUnreachableTemplateBindings}.
 */
const BINDING_DEPENDENT_KINDS = new Set(["sink_wrap", "manual_t"]);

interface ScriptBlock {
  /** Offset of `<`, and of the character after `</script>`. */
  start: number;
  end: number;
  /** Offset just inside the opening tag — where injected code goes. */
  contentStart: number;
  /** The opening tag, verbatim. */
  tag: string;
  /** The block's body. */
  body: string;
  isSetup: boolean;
}

/**
 * The SFC's real `<script>` blocks, in source order.
 *
 * Structural rather than a free-floating `/<script[^>]*setup/` scan, because
 * that scan reads a component's *prose*: a doc comment mentioning
 * `<script setup>` matched it, and injected imports landed in the middle of the
 * comment. Matching whole blocks means the body of a block — comments,
 * strings, anything — is never mistaken for the start of another one.
 */
function scriptBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const attrs = match[1] ?? "";
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      contentStart: match.index + match[0].length - (match[2] ?? "").length - "</script>".length,
      tag: `<script${attrs}>`,
      body: match[2] ?? "",
      // Attribute *values* are stripped first, so `<script src="setup.js">` is
      // not read as a setup block.
      isSetup: /(^|\s)setup(\s|$)/i.test(attrs.replace(/=\s*("[^"]*"|'[^']*'|\S+)/g, "")),
    });
  }
  return blocks;
}

/**
 * Rewrites that land outside every script block — i.e. in the template, where a
 * facet declaring `requiresScriptSetup` cannot reach a script-block binding.
 *
 * Exact, not generous — the filter L-006 and L-022 both paid for. Two shapes
 * are deliberately not counted, because both are correct as they stand:
 * strings that live only in the script block (the import lands in the same
 * scope as the rewrite), and any baked build (nothing is referenced at all).
 */
function templateBindingRewrites(blocks: ScriptBlock[], plan: ResolvedPlan): number {
  return plan.rewrites.filter(
    (rewrite) =>
      BINDING_DEPENDENT_KINDS.has(rewrite.kind) &&
      !blocks.some((block) => rewrite.start >= block.start && rewrite.end <= block.end),
  ).length;
}

/** The `lang` of an opening script tag, or undefined for a plain one. */
function scriptLang(scriptTag: string): string | undefined {
  const match = /\blang\s*=\s*["']([^"']+)["']/i.exec(scriptTag);
  return match ? match[1] : undefined;
}

/**
 * Why this component cannot be given a `<script setup>` block beside the one it
 * has — or undefined when it can. Each answer was measured against
 * `@vue/compiler-sfc@3.5.40` rather than reasoned about; see ledger L-053.
 */
function scriptSetupBlocker(block: ScriptBlock): string | undefined {
  if (/\bsrc\s*=/i.test(block.tag)) {
    return `its \`<script>\` uses \`src\`, which cannot be combined with \`<script setup>\``;
  }
  const lang = scriptLang(block.tag);
  if (lang && !/^(ts|js|tsx|jsx)$/i.test(lang)) {
    return `its \`<script lang="${lang}">\` is not JavaScript or TypeScript, so the two blocks cannot be compiled together`;
  }
  // Comments are stripped first so a passing mention of "setup:" in prose does
  // not read as a component option. A method genuinely named `setup` is the
  // case worth catching: the generated setup replaces it silently.
  const withoutComments = block.body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/\bsetup\s*[(:]/.test(withoutComments)) {
    return `it already declares a \`setup\` option, which the generated one would silently replace`;
  }
  return undefined;
}

/**
 * Fence for ledger L-053, on the shapes that cannot be made to work.
 *
 * A codegen facet declaring `requiresScriptSetup` is saying its templates
 * resolve against the component instance, not the script block's scope. So an
 * SFC with a plain `<script>` and a translatable *template* would get `_t` and
 * its manager imported into a scope the render function cannot see: the build
 * green, the catalogs right, and the page empty with `_ctx._t is not a
 * function`. Silent wrong output is the failure mode this project treats as
 * worse than a crash, so it becomes a crash.
 *
 * Most of these components are instead *fixed*, by authoring the `<script
 * setup>` block they lack — see the call site. This throws only for the
 * residue that authoring cannot serve.
 */
function refuseUnreachableTemplateBindings(
  filePath: string,
  count: number,
  blocker: string,
): never {
  throw new Error(
    `[Zintl] \`<script setup>\` is required for the ${count} translatable template ` +
      `string(s) in "${filePath}". Zintl would normally add a \`<script setup>\` block for you, ` +
      `but cannot here: ${blocker}. Without it, this framework compiles the template into a ` +
      `separate render function whose expressions resolve against the component instance, where ` +
      `the \`_t\` and manager bindings are not — the build would succeed and the page would ` +
      `render empty with \`_ctx._t is not a function\` (see ` +
      `docs/spec/proposals/027-leak-ledger.md, L-053). Convert this component to ` +
      `\`<script setup>\`, or move those strings into the script block.`,
  );
}

/**
 * Apply a resolved transformation plan to source code.
 */
export const apply: ApplyFn = (
  source: string,
  plan: ResolvedPlan,
  logger: ZintlLogger,
  filePath?: string,
  config?: ZintlConfig,
): TransformResult => {
  logger.debug("Applying transformation plan...");
  const ms = new MagicString(source);
  const diagnostics = [...plan.diagnostics];

  // 1. Apply Prepends (Managers) and New Imports
  let insertIndex = 0;
  let needsScriptWrapper = false;
  let authoredScriptOptions: { lang?: string } | undefined;
  let sfcFacet: any = null;

  const codegenFacets = config?.system?.codegenFacets;
  if (filePath && codegenFacets) {
    sfcFacet = codegenFacets.find((a: any) => a.match(filePath) && !!a.wrapSfcScript);
    if (sfcFacet) {
      const blocks = scriptBlocks(source);
      const setupBlock = blocks.find((block) => block.isSetup);
      const normalBlock = blocks.find((block) => !block.isSetup);
      const target = setupBlock || normalBlock;
      if (target) {
        insertIndex = target.contentStart;
      } else {
        needsScriptWrapper = true;
      }

      /**
       * Ledger L-053. This dialect's template cannot see a plain `<script>`'s
       * bindings, so injecting into the block the component already has would
       * build green and render empty. Vue compiles a `<script setup>` block
       * *beside* a normal one into the same module — imports hoisted to module
       * scope, the normal block's default export kept as the options object —
       * so authoring the missing block is the fix, and the fence is only for
       * the shapes that cannot take one.
       *
       * Only when the template actually needs a binding: a component whose
       * strings live in its script block is already correct, and switching its
       * compilation mode to buy nothing would be a change for its own sake.
       */
      if (!setupBlock && normalBlock && sfcFacet.requiresScriptSetup) {
        const needed = templateBindingRewrites(blocks, plan);
        if (needed > 0) {
          const blocker = scriptSetupBlocker(normalBlock);
          if (blocker) refuseUnreachableTemplateBindings(filePath, needed, blocker);
          needsScriptWrapper = true;
          authoredScriptOptions = { lang: scriptLang(normalBlock.tag) };
        }
      }
    }
  }

  if (sfcFacet) {
    if (needsScriptWrapper) {
      let scriptContent = "";
      for (const prepend of plan.prepends) {
        scriptContent += prepend.code + "\n";
      }
      for (const imp of plan.imports) {
        if (imp.strategy === "new") {
          scriptContent += `import { ${imp.specifiers.join(", ")} } from "${imp.source}";\n`;
        }
      }
      const scriptCode = sfcFacet.wrapSfcScript
        ? sfcFacet.wrapSfcScript(scriptContent, authoredScriptOptions)
        : scriptContent;
      ms.prepend(scriptCode);
    } else {
      let scriptCode = "\n";
      for (const prepend of plan.prepends) {
        scriptCode += prepend.code + "\n";
      }
      for (const imp of plan.imports) {
        if (imp.strategy === "new") {
          scriptCode += `import { ${imp.specifiers.join(", ")} } from "${imp.source}";\n`;
        }
      }
      ms.appendLeft(insertIndex, scriptCode);
    }
  } else {
    // Non-SFC behavior: prepend to the top of the file
    let clientDirectiveIndex = -1;
    const clientMatch = /^(?:\s|\/\/.*|\/\*[\s\S]*?\*\/)*['"]use client['"];?/i.exec(source);
    if (clientMatch) {
      clientDirectiveIndex = clientMatch[0].length;
    }

    if (clientDirectiveIndex !== -1) {
      let prepCode = "\n";
      for (const prepend of plan.prepends) {
        prepCode += prepend.code + "\n";
      }
      for (const imp of plan.imports) {
        if (imp.strategy === "new") {
          prepCode += `import { ${imp.specifiers.join(", ")} } from "${imp.source}";\n`;
        }
      }
      ms.appendLeft(clientDirectiveIndex, prepCode);
    } else {
      for (const prepend of plan.prepends) {
        ms.prepend(prepend.code + "\n");
      }
      for (const imp of plan.imports) {
        if (imp.strategy === "new") {
          ms.prepend(`import { ${imp.specifiers.join(", ")} } from "${imp.source}";\n`);
        }
      }
    }
  }

  // 2. Apply Replaced/Merged Imports
  for (const imp of plan.imports) {
    if (imp.strategy === "new") continue;
    try {
      if (imp.strategy === "replace" && imp.location) {
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
      logger.error(
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
        logger.error(
          `MagicString.appendLeft failed: start=${rewrite.start}, sourceLength=${source.length}, replacement=${rewrite.replacement}`,
        );
        throw err;
      }
    } else {
      try {
        ms.overwrite(rewrite.start, rewrite.end, rewrite.replacement);
      } catch (err: any) {
        logger.error(
          `MagicString.overwrite failed: start=${rewrite.start}, end=${rewrite.end}, sourceLength=${source.length}, replacement=${rewrite.replacement}`,
        );
        logger.error(`Full Plan Rewrites:`, JSON.stringify(plan.rewrites, null, 2));
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
