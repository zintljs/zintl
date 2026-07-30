import type { ZintlFacet, TargetDescriptor } from "@zintl/compiler";

interface VanillaFacetOptions {
  targets?: TargetDescriptor[];
  extensions?: string[];
}

/**
 * Vanilla extraction contribution.
 * Covers DOM property sinks (innerHTML, textContent, title, alt, placeholder, etc.)
 * for plain HTML, vanilla JS, and TS files.
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
