/**
 * Test fixtures for the extractor.
 *
 * The extractor is a framework-blind executor: it no longer carries preset
 * target lists, SFC block rules, mustache patterns or suppression rules, and it
 * has no default target set. Production supplies all of that from the facet
 * presets in `@zintl/compiler/facets`, which are the single source of truth.
 *
 * These fixtures are *test inputs* that stand in for what a caller would pass.
 * They intentionally duplicate a slice of the real presets — the extractor
 * cannot import the compiler (that is the wrong direction), and a test that
 * declares the sinks it exercises is clearer than one relying on a hidden
 * default. If a fixture drifts from the real preset it only affects this suite;
 * the production pairing is covered by the contract snapshots.
 */
import type { SfcRule, SuppressionRule, TargetDescriptor } from "../../types.js";

/** Plain-DOM sinks. */
export const DOM_TARGETS: TargetDescriptor[] = [
  "dom:prop:innerHTML",
  "dom:prop:textContent",
  "dom:prop:innerText",
  "dom:prop:value",
  "dom:prop:placeholder",
  "dom:prop:title",
  "dom:prop:ariaLabel",
];

/** JSX attribute and object-field sinks. */
export const JSX_TARGETS: TargetDescriptor[] = [
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
];

/** HTML attribute sinks. */
export const HTML_TARGETS: TargetDescriptor[] = [
  "html:attr:alt",
  "html:attr:aria-label",
  "html:attr:title",
  "html:attr:placeholder",
  "html:attr:dir",
];

/** The sink set most extractor tests want: DOM + JSX + HTML. */
export const BASE_TARGETS: TargetDescriptor[] = [...DOM_TARGETS, ...JSX_TARGETS, ...HTML_TARGETS];

const scriptBlock = {
  id: "script",
  pattern: /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  action: "javascript" as const,
  resolveVirtualExtension: (attrs: string) => {
    const langMatch = /lang=["']([^"']+)["']/i.exec(attrs);
    const lang = langMatch ? langMatch[1] : "js";
    return lang === "ts" || lang === "tsx" ? ".tsx" : ".jsx";
  },
};

const styleBlock = {
  id: "style",
  pattern: /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
  action: "ignore" as const,
};

/** Mirrors `vueExtractionFacet().sfcRules`. */
export const VUE_SFC_RULES: SfcRule[] = [
  {
    extensions: [".vue"],
    blocks: [
      scriptBlock,
      {
        id: "template",
        pattern: /<template\b([^>]*)>([\s\S]*?)<\/template>/gi,
        action: "html",
        isActiveContent: true,
      },
      styleBlock,
    ],
  },
];

/** Mirrors `vueExtractionFacet().mustacheRegex`. */
export const VUE_MUSTACHE = /\{\{([\s\S]*?)\}\}/g;

/** Mirrors `svelteExtractionFacet().sfcRules`. */
export const SVELTE_SFC_RULES: SfcRule[] = [
  {
    extensions: [".svelte"],
    blocks: [scriptBlock, styleBlock],
  },
];

/** Mirrors `svelteExtractionFacet().mustacheRegex`. */
export const SVELTE_MUSTACHE = /\{([^{}]+)\}/g;

/** Mirrors `nextjsExtractionFacet().suppressionRules`. */
export const NEXTJS_SUPPRESSION_RULES: SuppressionRule[] = [
  {
    match: {
      types: ["FunctionDeclaration", "VariableDeclarator"],
      names: ["generateMetadata", "generateViewport", "metadata", "viewport"],
      isTopLevel: true,
    },
    bypassIf: "hasAnchor",
  },
];
