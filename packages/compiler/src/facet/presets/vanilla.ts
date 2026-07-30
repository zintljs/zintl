import type { ZintlFacet, TargetDescriptor } from "@zintl/compiler";

export interface VanillaFacetOptions {
  /**
   * Replace the sinks that are scanned for translatable strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default DOM property sinks (`innerHTML`, `textContent`, `innerText`,
   * `title`, `alt`, `placeholder`, `aria-label`, `aria-description`, `value`)
   * plus the `label`, `description` and `tooltip` object fields
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".ts", ".js", ".mts", ".mjs"]
   */
  extensions?: string[];
}

/**
 * Extraction for plain JavaScript and TypeScript.
 *
 * Picks up strings assigned to DOM properties — `innerHTML`, `textContent`,
 * `title`, `alt`, `placeholder`, `aria-label` and friends — and the `label` /
 * `description` / `tooltip` fields of plain objects. This is what makes a
 * framework-less app translatable with no annotation at all.
 *
 * Included in `"auto"`, for every project, alongside whichever framework was
 * detected.
 */
export function vanillaFacet(options: VanillaFacetOptions = {}): ZintlFacet {
  return {
    name: "vanilla-extraction",
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
      "dom:prop:innerHTML",
      "dom:prop:textContent",
      "dom:prop:innerText",
      "dom:prop:title",
      "dom:prop:alt",
      "dom:prop:placeholder",
      "dom:prop:aria-label",
      "dom:prop:aria-description",
      "dom:prop:value",
      "obj:field:label",
      "obj:field:description",
      "obj:field:tooltip",
      "obj:field:placeholder",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".ts", ".js", ".mts", ".mjs"],
  };
}
