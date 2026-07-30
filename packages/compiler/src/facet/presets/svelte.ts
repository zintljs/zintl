import type { ZintlFacet, TargetDescriptor } from "@zintl/compiler";

export interface SvelteFacetOptions {
  /**
   * Replace the attributes and object fields scanned for strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".svelte"]
   */
  extensions?: string[];
}

/**
 * Extraction for Svelte components.
 *
 * Reads `<script>` as code and markup as HTML, skipping `<style>`, and treats
 * `{expr}` interpolations as variables inside the surrounding sentence so a
 * phrase is extracted whole.
 *
 * Half of {@link svelteFacet}.
 */
export function svelteExtractionFacet(options: SvelteFacetOptions = {}): ZintlFacet {
  return {
    name: "svelte-extraction",
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
      "dom:prop:innerHTML",
      "dom:prop:textContent",
      "jsx:*:aria-label",
      "jsx:*:aria-description",
      "jsx:*:title",
      "jsx:*:alt",
      "jsx:*:placeholder",
      "obj:field:label",
      "obj:field:description",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".svelte"],
    sfcRules: [
      {
        extensions: options.extensions || [".svelte"],
        blocks: [
          {
            id: "script",
            pattern: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
            action: "javascript",
            resolveVirtualExtension: (attrs) => {
              const langMatch = /lang=["']([^"']+)["']/i.exec(attrs);
              const lang = langMatch ? langMatch[1] : "js";
              return lang === "ts" || lang === "tsx" ? ".tsx" : ".jsx";
            },
          },
          {
            id: "style",
            pattern: /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
            action: "ignore",
          },
        ],
      },
    ],
    mustacheRegex: /\{([^{}]+)\}/g,
  };
}

/**
 * Codegen for Svelte components.
 *
 * Writes translations back in Svelte's own syntax: `{ }` for text, `{@html }`
 * when the translation carries markup, and `attr={...}` for attributes.
 *
 * Half of {@link svelteFacet}.
 */
export function svelteCodegenFacet(options: SvelteFacetOptions = {}): ZintlFacet {
  return {
    name: "svelte-codegen",
    concern: "codegen",
    priority: 100,
    extensions: options.extensions || [".svelte"],
    match: (filePath: string) => filePath.endsWith(".svelte"),
    wrapSfcScript: (code: string): string => `<script>\n${code}</script>\n`,
    wrapHtmlText: (replacement: string, hasTags: boolean, _hasVars: boolean): string => {
      if (hasTags) {
        return `{@html ${replacement} }`;
      }
      return `{ ${replacement} }`;
    },
    wrapHtmlAttribute: (attrName: string, replacement: string, _hasVars: boolean): string => {
      return `${attrName}={${replacement}}`;
    },
    quoteLiteral: (s: string): string => {
      const escaped = s
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\{/g, "\\x7b")
        .replace(/\}/g, "\\x7d");
      return "'" + escaped + "'";
    },
  };
}

/**
 * Full Svelte support: {@link svelteExtractionFacet} plus {@link svelteCodegenFacet}.
 *
 * Included in `"auto"` when Svelte or SvelteKit is detected.
 */
export function svelteFacet(options: SvelteFacetOptions = {}): ZintlFacet[] {
  return [svelteExtractionFacet(options), svelteCodegenFacet(options)];
}
