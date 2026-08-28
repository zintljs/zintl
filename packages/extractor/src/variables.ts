/**
 * One derivation of a placeholder's name, and one of the binding behind it.
 *
 * ## Why this is a module
 *
 * `${user.firstName}` becomes `{user_firstName}` in the extracted text, and
 * three separate places used to decide that independently: the template branch
 * of `findLiteralsInExpression`, which names the placeholder; `bindings.ts`,
 * which pairs a name back to its expression for DOM sinks; and `jsx.ts`, which
 * did the same for JSX expression containers.
 *
 * They have to agree, because the pairing is done **by name** — a variable is
 * only recorded if the name derived from the expression matches one the text
 * already contains. Two of the three agreed. The JSX copy handled only
 * `Identifier`, so `${user.firstName}` was named `var0` there and
 * `user_firstName` everywhere else, the `includes` test failed, and every
 * template literal inside JSX reached the compiler with its placeholder intact
 * and **no record of the expression behind it**.
 *
 * Nothing announced that. The text was right, the sink existed, and the only
 * symptom was a missing field nobody read until proposal 032 §3 wanted to tell
 * a translator that `{input}` is `user.firstName`. A derivation duplicated
 * three ways is a derivation that will drift; this is the one copy.
 */

import type { Node, TemplateLiteral } from "@oxc-project/types";
import type { LiteralSource, RawVariable } from "./types.js";

/**
 * The placeholder name for one interpolated expression.
 *
 * `user.firstName` → `user_firstName`, `count` → `count`, and anything the
 * shape of neither → `var<index>`, which is positional and therefore stable for
 * a given template but meaningless across an edit. That is the intended
 * trade-off: a name a translator can read where one exists, and a placeholder
 * that at least survives reordering where it does not.
 */
export function resolveExpressionName(expr: Node | undefined, index: number): string {
  if (!expr) return `var${index}`;
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
    }
    // A computed or call-rooted member chain — the tail is the only readable
    // part, and it beats `var0` for a translator trying to picture the value.
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return `var${index}`;
}

/**
 * The bindings behind one literal's placeholders, with their source text.
 *
 * Only template literals have interpolations to recover, so anything else has
 * no bindings by construction rather than by omission.
 *
 * Two filters, both load-bearing:
 *
 * - **By name**, because `source.variables` is what actually survived into the
 *   extracted text. A stitched fragment carries only the placeholders inside
 *   it, and attaching the whole template's bindings to each fragment would tell
 *   a translator that `{count}` is available in a sentence that has no
 *   `{count}` in it.
 * - **By range**, for the same reason from the other direction: a fragment
 *   declares the span it came from, and an expression outside that span belongs
 *   to a different sentence.
 *
 * Takes `code` rather than the extraction context so this module stays free of
 * the visitors that use it.
 */
export function extractRawVariables(source: LiteralSource, code: string): RawVariable[] {
  if (!source.variables?.length || source.node.type !== "TemplateLiteral") return [];

  const node = source.node as TemplateLiteral;
  const variables: RawVariable[] = [];

  node.expressions.forEach((expr: any, i: number) => {
    const originalName = resolveExpressionName(expr, i);
    const name = source.normalizedVariables?.[originalName] ?? originalName;
    const withinRange =
      !source.transformStart ||
      (expr.start >= source.transformStart &&
        source.transformEnd !== undefined &&
        expr.end <= source.transformEnd);

    if (source.variables!.includes(name) && withinRange) {
      variables.push({
        name,
        originalName,
        expression: code.slice(expr.start, expr.end),
        start: expr.start,
        end: expr.end,
      });
    }
  });

  return variables;
}
