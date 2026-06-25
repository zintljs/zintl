import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

// ── HTML Extraction Adapter ───────────────────────────────────────────────────

/**
 * HTML extraction adapter.
 * Covers translatable HTML attributes in .html files.
 */
const htmlExtractionAdapter: ZintlAdapter = {
  name: "html-extraction",
  extraction: {
    targets: [
      "html:attr:alt",
      "html:attr:title",
      "html:attr:placeholder",
      "html:attr:aria-label",
      "html:attr:aria-description",
      "html:attr:label",
      "html:attr:description",
      "html:attr:tooltip",
    ],
    extensions: [".html"],
  },
};

registerPreset("html", () => [htmlExtractionAdapter]);

export { htmlExtractionAdapter };
