import type { ZintlFacet, TargetDescriptor } from "../types.js";

export interface VueFacetOptions {
  targets?: TargetDescriptor[];
  extensions?: string[];
}

export function vueExtractionFacet(options: VueFacetOptions = {}): ZintlFacet {
  return {
    name: "vue-extraction",
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

export function vueCodegenFacet(options: VueFacetOptions = {}): ZintlFacet {
  return {
    name: "vue-codegen",
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

export function vueFacet(options: VueFacetOptions = {}): ZintlFacet[] {
  return [vueExtractionFacet(options), vueCodegenFacet(options)];
}
