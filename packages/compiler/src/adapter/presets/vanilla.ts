import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

/**
 * Vanilla extraction adapter.
 * Covers DOM property sinks (innerHTML, textContent, title, alt, placeholder, etc.)
 * for plain HTML, vanilla JS, and TS files.
 */
const vanillaExtractionAdapter: ZintlAdapter = {
  name: "vanilla-extraction",
  extraction: {
    targets: [
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
    ],
    extensions: [".ts", ".js", ".mts", ".mjs"],
  },
};

registerPreset("vanilla", () => [vanillaExtractionAdapter]);

export { vanillaExtractionAdapter };
