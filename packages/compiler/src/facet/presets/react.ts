import type { CodegenFacet, ZintlFacet, TagMapEntry, TargetDescriptor } from "@zintl/compiler";

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
  targets?: TargetDescriptor[];
  extensions?: string[];
}

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

export function reactFacet(options: ReactFacetOptions = {}): ZintlFacet[] {
  return [reactExtractionFacet(options), reactCodegenFacet(options)];
}
