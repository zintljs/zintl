import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

// ── Vue Extraction Adapter ────────────────────────────────────────────────────

const vueExtractionAdapter: ZintlAdapter = {
  name: "vue-extraction",
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
      "obj:field:tooltip",
    ],
    extensions: [".vue"],
  },
};

// ── Vue Codegen Adapter ───────────────────────────────────────────────────────

/**
 * Vue codegen adapter.
 * Handles SFC template output: v-html for rich HTML text, :attr binding syntax.
 */
const vueCodegenAdapter: ZintlAdapter = {
  name: "vue-codegen",
  codegen: {
    extensions: [".vue"],
    match: (filePath: string) => filePath.endsWith(".vue"),
    wrapSfcScript: (code: string): string => `<script setup lang="ts">\n${code}</script>\n`,
    wrapHtmlText: (replacement: string, hasTags: boolean, _hasVars: boolean): string => {
      if (hasTags) {
        return `<span v-html="${replacement.replace(/"/g, "&quot;")}"></span>`;
      }
      return `{{ ${replacement} }}`;
    },
    wrapHtmlAttribute: (attrName: string, replacement: string, _hasVars: boolean): string => {
      return `:${attrName}="${replacement}"`;
    },
    // Vue does not use JSX rich text or React's tag serialization
    wrapJsxRichText: undefined,
    serializeTags: undefined,
    convertToHtmlTemplate: undefined,
    // Vue uses single-quote with curly-brace escaping for SFC literals
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

registerPreset("vue", () => [vueExtractionAdapter, vueCodegenAdapter]);

export { vueExtractionAdapter, vueCodegenAdapter };
