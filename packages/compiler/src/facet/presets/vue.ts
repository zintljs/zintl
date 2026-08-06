import type { ZintlFacet, TargetDescriptor } from "@zintljs/compiler";

export interface VueFacetOptions {
  /**
   * Replace the attributes and object fields scanned for strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   */
  targets?: TargetDescriptor[];
  /**
   * Replace the file extensions this facet claims.
   *
   * @default [".vue"]
   */
  extensions?: string[];
}

/**
 * Extraction for Vue single-file components.
 *
 * Splits an SFC into its blocks and treats each correctly: `<script>` is parsed
 * as TS or JS according to its `lang`, `<template>` is walked as HTML, and
 * `<style>` is skipped. `{{ }}` interpolations are read as variables inside the
 * surrounding sentence, so a phrase is extracted whole rather than in pieces.
 *
 * Half of {@link vueFacet}.
 */
export function vueExtractionFacet(options: VueFacetOptions = {}): ZintlFacet {
  return {
    name: "vue-extraction",
    when: { framework: "vue" },
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
      "obj:field:tooltip",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [".vue"],
    sfcRules: [
      {
        extensions: options.extensions || [".vue"],
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
            id: "template",
            pattern: /<template\b([^>]*)>([\s\S]*?)<\/template>/gi,
            action: "html",
            isActiveContent: true,
          },
          {
            id: "style",
            pattern: /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
            action: "ignore",
          },
        ],
      },
    ],
    mustacheRegex: /\{\{([\s\S]*?)\}\}/g,
  };
}

/**
 * Codegen for Vue single-file components.
 *
 * Writes translations back in Vue's own syntax: `{{ }}` for text, `v-html` when
 * the translation carries markup, and `:attr` bindings for attributes.
 *
 * Half of {@link vueFacet}.
 */
export function vueCodegenFacet(options: VueFacetOptions = {}): ZintlFacet {
  return {
    name: "vue-codegen",
    when: { framework: "vue" },
    concern: "codegen",
    priority: 100,
    extensions: options.extensions || [".vue"],
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
 * Full Vue support: {@link vueExtractionFacet} plus {@link vueCodegenFacet}.
 *
 * Included in the built-in set when Vue is detected.
 */
export function vueFacet(options: VueFacetOptions = {}): ZintlFacet[] {
  return [vueExtractionFacet(options), vueCodegenFacet(options)];
}
