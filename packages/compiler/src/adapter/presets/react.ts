import type { ZintlAdapter, TagMapEntry } from "../types.js";
import { registerPreset } from "../resolve.js";

// ── Helpers (moved from resolve-rewrites.ts) ──────────────────────────────────

/**
 * Convert JSX attribute syntax to HTML template literal syntax.
 * className="foo" → class="foo"
 * attr={expression} → attr="${expression}"
 */
function convertToHtmlTemplate(tagOpen: string): string {
  let html = tagOpen.replace(/\bclassName=/g, "class=");
  html = html.replace(/([a-zA-Z0-9_-]+)=\{([^}]+)\}/g, (_match, attrName, expr) => {
    return `${attrName}="\${${expr.trim()}}"`;
  });
  return html;
}

/**
 * Serialize a tag map for React — template literal syntax instead of JSON.
 * React needs originalOpen as a template literal for className→class conversion.
 */
function serializeTags(tags: TagMapEntry[]): string {
  const items = tags.map((entry) => {
    const htmlTemplate = convertToHtmlTemplate(entry.originalOpen);
    const escapedHtml = htmlTemplate.replace(/`/g, "\\`").replace(/\bclassName=/g, "class=");
    return `{ alias: ${JSON.stringify(entry.alias)}, originalOpen: \`${escapedHtml}\`, tagName: ${JSON.stringify(entry.tagName)} }`;
  });
  return `[${items.join(", ")}]`;
}

// ── React Extraction Adapter ──────────────────────────────────────────────────

const reactExtractionAdapter: ZintlAdapter = {
  name: "react-extraction",
  extraction: {
    targets: [
      "jsx:*:aria-label",
      "jsx:*:aria-description",
      "jsx:*:title",
      "jsx:*:alt",
      "jsx:*:placeholder",
      "jsx:*:label",
      "obj:field:label",
      "obj:field:description",
      "obj:field:tooltip",
      "obj:field:placeholder",
    ],
    extensions: [".tsx", ".jsx"],
  },
};

// ── React Codegen Adapter ─────────────────────────────────────────────────────

/**
 * React codegen adapter.
 * Handles JSX output: dangerouslySetInnerHTML for rich tags, className→class conversion,
 * JSX-aware tag serialization.
 *
 * matches: .tsx, .jsx, and any file not already claimed by an SFC codegen adapter
 * (the match function must be set up after all SFC adapters are known — the
 * `match` implementation here is a static heuristic; the resolution engine
 * ensures that SFC adapters are registered before the React fallback is tested.)
 */
const reactCodegenAdapter: ZintlAdapter = {
  name: "react-codegen",
  codegen: {
    extensions: [".tsx", ".jsx"],
    match: (filePath: string) => filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
    wrapJsxRichText: (replacement: string): string => {
      return `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${replacement} }} />`;
    },
    serializeTags,
    convertToHtmlTemplate,
    // React does not use SFC script wrapping
    wrapSfcScript: undefined,
    // React uses standard HTML attribute syntax for translatable attrs
    wrapHtmlText: undefined,
    wrapHtmlAttribute: undefined,
  },
};

registerPreset("react", () => [reactExtractionAdapter, reactCodegenAdapter]);

export { reactExtractionAdapter, reactCodegenAdapter };
