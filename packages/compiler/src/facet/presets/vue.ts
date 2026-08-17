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
    /**
     * Vue's half of the store subscription.
     *
     * `shallowRef` rather than `ref`: the value is a number and there is nothing
     * to deep-track, so the cheaper handle is also the honest one.
     *
     * `onScopeDispose` takes the unsubscribe `subscribe()` returns. Without it
     * every component instance would leave a listener behind on unmount, and the
     * store's listener set would grow for the life of the page — which the
     * `memory-leak` contract would eventually find, and which would be a poor
     * trade for the defect this fixes.
     *
     * `getCurrentScope()` guards the dispose registration: `onScopeDispose`
     * warns when called outside a component or effect scope, and a `_t` can be
     * reached from a plain module-level helper.
     */
    reactiveBridge: {
      /**
       * The framework import is written by the facet, inside `setup`, rather
       * than declared for the pipeline to place. The pipeline's import writer
       * merges by source across the whole file, and for a `.vue` file that put
       * `import … from "vue"` *above* the `<script setup>` tag — outside any
       * block, which is not a valid SFC. Where the import has to land is a
       * property of the dialect, so the dialect writes it.
       */
      setup: [
        'import { shallowRef, onScopeDispose, getCurrentScope } from "vue";',
        "const __zintl_v = shallowRef(getStoreVersion());",
        "const __zintl_off = subscribe(() => {",
        "  __zintl_v.value = getStoreVersion();",
        "});",
        "if (getCurrentScope()) onScopeDispose(__zintl_off);",
      ].join("\n"),
      read: "__zintl_v.value",
    },
    wrapSfcScript: (code: string, options?: { lang?: string }): string => {
      // No options means Zintl is authoring the component's only script block,
      // where TypeScript has always been the default. With options, the block
      // sits beside one that already exists and the language must match it
      // exactly — including matching "no lang" for a plain JavaScript SFC.
      const lang = options ? options.lang : "ts";
      return `<script setup${lang ? ` lang="${lang}"` : ""}>\n${code}</script>\n`;
    },
    requiresScriptSetup: true,
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
  return [vueExtractionFacet(options), vueCodegenFacet(options), vueRuntimeFacet()];
}

/**
 * Vue's half of {@link RuntimeFacet.repaintsOnCatalogUpdate}.
 *
 * Measured rather than reasoned: `rsbuild-vue-mpa` applies a catalog edit to its
 * heading with no reload, on a host whose applier invalidates nothing. Declaring
 * `false` here would take that warmth away and replace it with a page refresh,
 * which is why the flag is set — the alternative was measurably worse on a
 * project that already worked.
 *
 * **Necessary, not sufficient**, and the gap is recorded rather than papered
 * over: `rsbuild-vue-basic` and `rsbuild-vue-spa` still miss the repaint, and
 * the line between them and the MPA is not the framework but whether the
 * manager *inlines* the catalog or *fetches* it. A fetched catalog on this host
 * updates a module nothing re-runs. See ledger L-064.
 *
 * It declares no `entryReexecutionSafe`, so it keeps the permissive default: the
 * two flags answer different questions, and Vue's mount is replayable where
 * React's `createRoot` and Svelte's `mount` are not.
 */
function vueRuntimeFacet(): ZintlFacet {
  return {
    name: "vue-runtime",
    when: { framework: "vue" },
    concern: "runtime",
    priority: 100,
    repaintsOnCatalogUpdate: true,
  };
}
