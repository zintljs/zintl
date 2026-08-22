import type { CodegenFacet, ZintlFacet, TargetDescriptor } from "@zintljs/compiler";
import { convertToHtmlTemplate, JSX_TARGETS, serializeTags } from "./jsx.js";

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
    when: { framework: "react" },
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [...JSX_TARGETS]) as TargetDescriptor[],
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
    when: { framework: "react" },
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
 * Whether re-running a React entry is harmless. It is not.
 *
 * `createRoot(container)` on a container it already owns does not replace the
 * previous root — it warns and mounts a second one over the first, and the two
 * then render the same DOM independently. Proposal 024 §1.3 identified this and
 * could not act on it: marking React unsafe reached every framework-less project
 * while `FALLBACK_FRAMEWORK` was `"react"`, and it regressed `vanilla-spa-basic`.
 * Ledger L-034 removed that fallback, so the claim now reaches React and nothing
 * else.
 *
 * What made it actionable was a reproduction rather than the argument. Measured
 * on `react-basic` across sixty edits, the entry re-executed on roughly one edit
 * in ten and **every** re-execution produced the double mount — the two are
 * perfectly correlated. Half of those came from a defect in Vite's module-graph
 * repair and are fixed separately (L-023, `hmr/vite.ts`); this declaration is
 * what makes the remainder safe rather than rare.
 *
 * The cost is a full page reload on exactly those updates, which is the trade
 * `svelteRuntimeFacet` already makes for the same reason. It is not a reload per
 * edit: a React app's strings usually live in components, and a component update
 * never reaches this path.
 *
 * Declared here rather than in a bundler facet on purpose — whether a mount can
 * be replayed is framework knowledge, and both hosts' injection hooks consume it
 * without learning what React is.
 */
export function reactRuntimeFacet(): ZintlFacet {
  return {
    name: "react-runtime",
    when: { framework: "react" },
    concern: "runtime",
    priority: 100,
    entryReexecutionSafe: false,
    /**
     * Components read the store through `useSyncExternalStore`, so a delivered
     * catalog redraws them without the entry running again. Measured: a catalog
     * edit reaches the heading here with no reload.
     */
    repaintsOnCatalogUpdate: true,
  };
}

/**
 * Full React support: {@link reactExtractionFacet}, {@link reactCodegenFacet}
 * and {@link reactRuntimeFacet}.
 *
 * Components re-render on a locale change with no hook of yours, and JSX is
 * extracted as whole stitched units rather than fragments, so a sentence broken
 * across `<strong>` reaches translators as one sentence.
 *
 * Included in the built-in set when React is detected. Only then — detection
 * returns `[]` rather than guessing since ledger L-034.
 */
export function reactFacet(options: ReactFacetOptions = {}): ZintlFacet[] {
  return [reactExtractionFacet(options), reactCodegenFacet(options), reactRuntimeFacet()];
}
