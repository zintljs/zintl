import { isRuntimeSpecifier } from "../constants.js";
import type {
  Node,
  ImportDeclaration,
  ImportExpression,
  AssignmentExpression,
  ObjectProperty as Property,
} from "@oxc-project/types";
import { ExtractionContext } from "../context.js";
import { generateMessageId } from "../hashing.js";
import { getAttachedComments } from "../comments.js";
import type { LiteralSource } from "../types.js";
import { extractRawVariables } from "../variables.js";

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

  return resolved.replace(/\.(tsx?|jsx?)$/, "");
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

  const rawVars = extractRawVariables(source, ctx.code);
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

/**
 * Does a qualified target claim this field, given where the object literal sits?
 *
 * `obj:ui:title` and `call:defineConfig:title` both narrow an object-field match
 * by *context* rather than by the field name alone, which is what separates a
 * declared target from the guess `obj:*:title` makes. This resolves that
 * context by walking outward from the property to the nearest thing carrying a
 * name.
 *
 * Two names are collected in one pass, because a literal can sit inside both:
 *
 * - the nearest **call**, from a `CallExpression` with an identifier callee
 * - the nearest **binding**, from a declarator, function declaration or class
 *   field
 *
 * The walk crosses function bodies on purpose. `const ui = () => ({ title })`
 * and `function build() { return { title } }` are how a strings object gets
 * written as often as `const ui = { title }` is, and stopping at the function
 * would serve only the simplest of the three. It also does not stop at the
 * first object literal, so a field nested inside `const ui = { home: { title } }`
 * still resolves to `ui` — that nesting is what a real strings object looks
 * like.
 *
 * `export default { title }` carries no name and matches nothing here. That is
 * a real limit rather than an oversight: there is nothing to declare a target
 * against, and marking the site is what a directive is for.
 */
/**
 * Does this field set claim `field`, allowing `*` to mean every field?
 *
 * The wildcard has to work in **both** positions or it is a trap. `obj:*:title`
 * (any object, this field) was supported from the start; `obj:details:*` (this
 * object, every field) parsed, stored `"*"` as a literal field name, matched
 * nothing, and passed validation — a structurally valid triple with no empty
 * segments. Silently doing nothing is the exact defect the validation pass was
 * added to remove, reappearing one position over.
 *
 * `obj:details:*` is also the more useful half in practice: it says *this object
 * holds UI strings* without listing them, which is what a project reaches for
 * when the same shape appears in many components.
 */
function claims(fields: Set<string> | undefined, field: string): boolean {
  return fields !== undefined && (fields.has(field) || fields.has("*"));
}

function qualifiedObjectMatch(field: string, parents: Node[], ctx: ExtractionContext): boolean {
  if (ctx.uiObjectNameFields.size === 0 && ctx.uiCallFields.size === 0) return false;

  // `parents[0]` is the immediate parent and the array grows outward
  // (`walker.ts`: `[node, ...parents]`), so ascending index *is* walking
  // outward. Reversing this reads naturally and is wrong: an enclosing binding
  // would answer before the call or object nearer the literal.
  for (const parent of parents) {
    const node = parent as any;

    if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
      if (claims(ctx.uiCallFields.get(node.callee.name), field)) return true;
    }

    const bindingName =
      (node.type === "VariableDeclarator" || node.type === "FunctionDeclaration") &&
      node.id?.type === "Identifier"
        ? node.id.name
        : node.type === "PropertyDefinition" && node.key?.type === "Identifier"
          ? node.key.name
          : undefined;

    // The first binding is the answer, whether or not it claims the field —
    // walking past it would let an outer scope's name capture an inner object.
    if (bindingName !== undefined) {
      return claims(ctx.uiObjectNameFields.get(bindingName), field);
    }
  }

  return false;
}

export function createBindingVisitor(ctx: ExtractionContext) {
  const visitor: any = {
    ImportDeclaration(node: ImportDeclaration, ctx: ExtractionContext) {
      if (node.source.type !== ("StringLiteral" as any) && node.source.type !== ("Literal" as any))
        return;
      const sourceVal = (node.source as any).value;

      if (isRuntimeSpecifier(sourceVal, ctx.runtimePackage)) {
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

    /**
     * The statement shapes a `@zintl-target` can sit above.
     *
     * `VariableDeclaration` is handled with the ignore region below, since the
     * two directives share a node. These are the rest, and they are exactly the
     * sites the declared targets of §4 cannot reach: an anonymous default
     * export has no binding to name, and an object passed inline to a call has
     * one only if the callee is an identifier the project controls.
     *
     * `ReturnStatement` and `PropertyDefinition` are here so a marked region
     * behaves the same wherever an object is produced, matching how the binding
     * walk crosses function bodies.
     */
    ImportExpression(node: ImportExpression, ctx: ExtractionContext) {
      const src = node.source as any;
      if ((src.type === "StringLiteral" || src.type === "Literal") && src.value.startsWith(".")) {
        const resolved = resolveBoundaryId(ctx, src.value);
        if (resolved !== null && !ctx.dependencyPaths.has(resolved)) {
          ctx.dependencyPaths.set(resolved, true);
        }
      }
    },

    VariableDeclaration: {
      enter(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        ctx.pushTarget(comments);
        if (comments.ignore) {
          ctx.suppressionLevel++;
        }
      },
      exit(node: any, ctx: ExtractionContext, parents: Node[]) {
        const comments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
        ctx.popTarget(comments);
        if (comments.ignore) {
          ctx.suppressionLevel--;
        }
      },
    },
  };

  if (ctx.hasDomSinks) {
    visitor.AssignmentExpression = function (
      node: AssignmentExpression,
      ctx: ExtractionContext,
      parents: Node[],
    ) {
      if (ctx.suppressionLevel > 0) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active || node.left.type !== "MemberExpression") return;

      const prop =
        (node.left as any).property.type === "Identifier" ? (node.left as any).property.name : "";

      if (!ctx.uiSinkProperties.includes(prop)) {
        /**
         * Not an any-receiver property. It may still be receiver-qualified —
         * `dom:document:title` matches `document.title` and nothing else, which
         * is what lets the browser tab be a default sink while `telemetry.title`
         * is not.
         *
         * The receiver must be a plain identifier. `window.document.title` and
         * `globalThis.document.title` are member expressions and do not match;
         * that is a deliberate floor rather than an oversight, because widening
         * it means walking arbitrary member chains and re-admitting the guessing
         * this descriptor exists to remove.
         */
        const object = (node.left as any).object;
        if (object?.type !== "Identifier") return;
        if (!ctx.uiSinkReceiverProperties.get(object.name)?.has(prop)) return;
      }

      const stmtComments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      const sources = ctx.findLiteralsInExpression(node.right as Node, stmtComments, prop);

      sources.forEach((source) =>
        processSinkSource(source, prop, boundaryId, parents[0]?.start ?? node.start, ctx),
      );
    };
  }

  if (ctx.hasTaggedTemplateSinks) {
    /**
     * A tagged template literal whose tag is a configured `tag:` target.
     *
     * The body is handed to the same `findLiteralsInExpression` that reads an
     * `innerHTML =` assignment, and for the same reason: a template literal is a
     * template literal, and HTML stitching is decided by the *content* — whether
     * it contains tags — not by how the string was reached. So markup inside
     * ``html`<p>Hello <b>you</b></p>` `` stitches into one key with its tag map,
     * and `${expr}` interpolations normalize to `{expr}` placeholders, exactly as
     * they do in a vanilla `el.innerHTML = ` template.
     *
     * Only a bare identifier tag is matched. `lit.html`…`` and other member
     * expressions are deliberately not: the tag would have to be resolved
     * through imports and aliases to say what it actually is, and guessing from
     * the last property name would claim any `x.html` in the file.
     */
    visitor.TaggedTemplateExpression = function (
      node: any,
      ctx: ExtractionContext,
      parents: Node[],
    ) {
      if (ctx.suppressionLevel > 0) return;
      const { id: boundaryId, active } = ctx.getActiveBoundary();
      if (!active) return;
      if (node.tag?.type !== "Identifier") return;

      const tagName = node.tag.name as string;
      if (!ctx.taggedTemplates.has(tagName)) return;

      const stmtComments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      if (stmtComments.ignore) return;

      const sources = ctx.findLiteralsInExpression(node.quasi as Node, stmtComments, tagName);
      sources.forEach((source) =>
        processSinkSource(source, tagName, boundaryId, parents[0]?.start ?? node.start, ctx),
      );
    };
  }

  /**
   * `@zintl-target` regions, registered only for a file that contains one.
   *
   * The gate is not an optimisation, it is the difference between free and
   * quadratic. `getAttachedComments` scans **every trivia in the file** per
   * call, with a slice and two regexes per candidate — and these hooks fire on
   * enter *and* exit of `ExpressionStatement` and `ReturnStatement`, which are
   * the most common statements there are. Registered unconditionally that is
   * O(statements x comments) of work added to every file in every project, to
   * discover that none of them carry the directive.
   *
   * `VariableDeclaration` is handled with the ignore region below, since the two
   * directives share that node and its cost was already being paid.
   *
   * These are exactly the sites §4's declared targets cannot reach: an anonymous
   * default export has no binding to name, and an inline call argument has one
   * only if the callee is an identifier the project controls. `ReturnStatement`
   * and `PropertyDefinition` are here so a marked region behaves the same
   * wherever an object is produced, matching how the binding walk crosses
   * function bodies.
   */
  if (ctx.code.includes("@zintl-target")) {
    for (const type of [
      "ExportDefaultDeclaration",
      "ExpressionStatement",
      "ReturnStatement",
      "PropertyDefinition",
    ] as const) {
      (visitor as any)[type] = {
        enter(node: any, ctx: ExtractionContext, parents: Node[]) {
          ctx.pushTarget(getAttachedComments(node, parents, ctx.trivias, ctx.code));
        },
        exit(node: any, ctx: ExtractionContext, parents: Node[]) {
          ctx.popTarget(getAttachedComments(node, parents, ctx.trivias, ctx.code));
        },
      };
    }
  }

  /**
   * Registered when *something* could match: a configured object-field target of
   * any kind, or a `@zintl-target` anywhere in this file.
   *
   * The last clause is a one-off string scan rather than a per-node check, and
   * it is what keeps the fast path: without it the visitor runs on every
   * `Property` in every project, including the many that configure no object
   * targets at all, to answer "no" each time.
   */
  if (
    ctx.uiObjectFields.size > 0 ||
    ctx.uiObjectNameFields.size > 0 ||
    ctx.uiCallFields.size > 0 ||
    ctx.code.includes("@zintl-target")
  ) {
    visitor.Property = function (node: Property, ctx: ExtractionContext, parents: Node[]) {
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

      /**
       * A `@zintl-target` region makes every field a sink, whatever it is
       * called. That is the point: the directive exists for objects whose field
       * names carry no signal, and requiring the names to *also* be configured
       * would leave it useful only where the configuration already sufficed.
       *
       * `@zintl-ignore` still applies inside — it is checked above — so the
       * pair composes: mark the object, exclude the one field that is a URL.
       */
      if (
        ctx.targetLevel === 0 &&
        !ctx.uiObjectFields.has(keyName) &&
        !qualifiedObjectMatch(keyName, parents, ctx)
      ) {
        return;
      }

      const stmtComments = getAttachedComments(node, parents, ctx.trivias, ctx.code);
      const sources = ctx.findLiteralsInExpression(node.value as Node, stmtComments, keyName);

      sources.forEach((source) =>
        processSinkSource(source, keyName, boundaryId, parents[0]?.start ?? node.start, ctx),
      );
    };
  }

  return visitor;
}
