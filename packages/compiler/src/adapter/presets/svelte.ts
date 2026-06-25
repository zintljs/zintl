import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

// ── Svelte Extraction Adapter ─────────────────────────────────────────────────

const svelteExtractionAdapter: ZintlAdapter = {
  name: "svelte-extraction",
  extraction: {
    targets: [
      "dom:prop:innerHTML",
      "dom:prop:textContent",
      "jsx:*:aria-label",
      "jsx:*:aria-description",
      "jsx:*:title",
      "jsx:*:alt",
      "jsx:*:placeholder",
      "obj:field:label",
      "obj:field:description",
    ],
    extensions: [".svelte"],
  },
};

// ── Svelte Codegen Adapter ────────────────────────────────────────────────────

/**
 * Svelte codegen adapter.
 * Handles SFC template output: {@html} for rich HTML text, attr={} binding syntax.
 */
const svelteCodegenAdapter: ZintlAdapter = {
  name: "svelte-codegen",
  codegen: {
    extensions: [".svelte"],
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
    // Svelte does not use JSX rich text or React's tag serialization
    wrapJsxRichText: undefined,
    serializeTags: undefined,
    convertToHtmlTemplate: undefined,
    // Svelte uses single-quote with curly-brace escaping for SFC literals (same as Vue)
    quoteLiteral: (s: string): string => {
      const escaped = s
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\{/g, "\\x7b")
        .replace(/\}/g, "\\x7d");
      return "'" + escaped + "'";
    },
  },
};

registerPreset("svelte", () => [svelteExtractionAdapter, svelteCodegenAdapter]);

export { svelteExtractionAdapter, svelteCodegenAdapter };
