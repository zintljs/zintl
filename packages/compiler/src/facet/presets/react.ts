import type { ZintlFacet, TagMapEntry } from "../types.js";

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

// ── React Extraction Contribution ─────────────────────────────────────────────

const reactExtractionFacet: ZintlFacet = {
  name: "react-extraction",
  concern: "extraction",
  priority: 100,
  targets: [
    "jsx:*:aria-label",
    "jsx:*:alt",
    "jsx:*:title",
    "jsx:*:placeholder",
    "jsx:*:aria-description",
    "jsx:*:label",
    "jsx:*:description",
    "jsx:*:tooltip",
    "jsx:html:dir",
    "obj:field:label",
    "obj:field:title",
    "obj:field:description",
    "obj:field:text",
    "obj:field:tooltip",
    "obj:field:placeholder",
  ],
  extensions: [".tsx", ".jsx"],
};

// ── React Codegen Contribution ────────────────────────────────────────────────

/**
 * React codegen contribution.
 * Handles JSX output: dangerouslySetInnerHTML for rich tags, className→class conversion,
 * JSX-aware tag serialization.
 */
const reactCodegenFacet: ZintlFacet = {
  name: "react-codegen",
  concern: "codegen",
  priority: 100,
  extensions: [".tsx", ".jsx"],
  match: (filePath: string) => filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
  wrapJsxRichText: (replacement: string): string => {
    return `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${replacement} }} />`;
  },
  serializeTags,
  convertToHtmlTemplate,
};

export { reactExtractionFacet, reactCodegenFacet };
