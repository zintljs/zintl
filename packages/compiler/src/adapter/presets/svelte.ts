import type { ZintlAdapter } from "../types.js";
import { registerPreset } from "../resolve.js";

// ── Svelte Extraction Contribution ─────────────────────────────────────────────────

const svelteExtractionAdapter: ZintlAdapter = {
  name: "svelte-extraction",
  type: "extraction",
  priority: 100,
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
  sfcRules: [
    {
      extensions: [".svelte"],
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

// ── Svelte Codegen Contribution ────────────────────────────────────────────────────

/**
 * Svelte codegen contribution.
 * Handles SFC template output: {@html} for rich HTML text, attr={} binding syntax.
 */
const svelteCodegenAdapter: ZintlAdapter = {
  name: "svelte-codegen",
  type: "codegen",
  priority: 100,
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
  quoteLiteral: (s: string): string => {
    const escaped = s
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\{/g, "\\x7b")
      .replace(/\}/g, "\\x7d");
    return "'" + escaped + "'";
  },
};

registerPreset("svelte", () => [svelteExtractionAdapter, svelteCodegenAdapter]);

export { svelteExtractionAdapter, svelteCodegenAdapter };
