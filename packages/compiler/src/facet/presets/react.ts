import type { CodegenFacet, ZintlFacet, TagMapEntry, TargetDescriptor } from "@zintljs/compiler";

// ── Helpers ──────────────────────────────────────────────────────────────────

function convertToHtmlTemplate(tagOpen: string): string {
  let html = tagOpen.replace(/\bclassName=/g, "class=");
  html = html.replace(/([a-zA-Z0-9_-]+)=\{([^}]+)\}/g, (_match, attrName, expr) => {
    return `${attrName}="\${${expr.trim()}}"`;
  });
  return html;
}

function serializeTags(tags: TagMapEntry[]): string {
  const items = tags.map((entry) => {
    const htmlTemplate = convertToHtmlTemplate(entry.originalOpen);
    const escapedHtml = htmlTemplate.replace(/`/g, "\\`").replace(/\bclassName=/g, "class=");
    return `{ alias: ${JSON.stringify(entry.alias)}, originalOpen: \`${escapedHtml}\`, tagName: ${JSON.stringify(entry.tagName)} }`;
  });
  return `[${items.join(", ")}]`;
}

// ── Facets ───────────────────────────────────────────────────────────────────

export interface ReactFacetOptions {
  /**
   * Replace the JSX attributes and object fields scanned for strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default `aria-label`, `alt`, `title`, `placeholder`, `aria-description`,
   * `label`, `description`, `tooltip` and `<html dir>`
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".tsx", ".jsx"]
   */
  extensions?: string[];
}

/**
 * Extraction for React files: JSX text and the translatable JSX attributes.
 *
 * Half of {@link reactFacet}. Take it alone only to pair React extraction with
 * a different codegen.
 */
export function reactExtractionFacet(options: ReactFacetOptions = {}): ZintlFacet {
  return {
    name: "react-extraction",
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
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
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".tsx", ".jsx"],
  };
}

/**
 * Codegen for React: rich-text output and re-rendering on locale change.
 *
 * Emits translations that contain markup as a `display: contents` span, so the
 * surrounding layout is untouched, and declares that components subscribing to
 * the store need `useSyncExternalStore` — the compiler injects the subscription
 * without ever learning what React is.
 *
 * Half of {@link reactFacet}.
 */
export function reactCodegenFacet(options: ReactFacetOptions = {}): CodegenFacet {
  return {
    name: "react-codegen",
    concern: "codegen",
    // React needs this hook when the compiler injects client reactivity.
    // The compiler must not know that; the framework declares it.
    clientReactivityImports: { react: ["useSyncExternalStore"] },
    priority: 100,
    extensions: options.extensions || [".tsx", ".jsx"],
    match: (filePath: string) => filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
    wrapJsxRichText: (replacement: string): string => {
      return `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ${replacement} }} />`;
    },
    serializeTags,
    convertToHtmlTemplate,
  };
}

/**
 * Full React support: {@link reactExtractionFacet} plus {@link reactCodegenFacet}.
 *
 * Components re-render on a locale change with no hook of yours, and JSX is
 * extracted as whole stitched units rather than fragments, so a sentence broken
 * across `<strong>` reaches translators as one sentence.
 *
 * Included in `"auto"` when React is detected — and when nothing is detected at
 * all, since React is the fallback.
 */
export function reactFacet(options: ReactFacetOptions = {}): ZintlFacet[] {
  return [reactExtractionFacet(options), reactCodegenFacet(options)];
}
