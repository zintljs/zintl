import type { CodegenFacet, ZintlFacet, TargetDescriptor } from "@zintljs/compiler";
import { convertToHtmlTemplate, JSX_TARGETS, serializeTags } from "./jsx.js";

export interface PreactFacetOptions {
  /**
   * Replace the JSX attributes and object fields scanned for strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default the shared JSX target set — `aria-label`, `alt`, `title`,
   * `placeholder`, `aria-description`, `label`, `description`, `tooltip`,
   * `<html dir>` and the translatable object fields
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
 * Extraction for Preact files: JSX text and the translatable JSX attributes.
 *
 * Identical to React's, because the syntax is identical — both read from
 * {@link JSX_TARGETS}. Half of {@link preactFacet}.
 */
export function preactExtractionFacet(options: PreactFacetOptions = {}): ZintlFacet {
  return {
    name: "preact-extraction",
    when: { framework: "preact" },
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [...JSX_TARGETS]) as TargetDescriptor[],
    extensions: options.extensions || [".tsx", ".jsx"],
  };
}

/**
 * Codegen for Preact: rich-text output and re-rendering on locale change.
 *
 * Preact implements `dangerouslySetInnerHTML`, so rich text is emitted exactly
 * as React's is — a `display: contents` span, leaving the surrounding layout
 * untouched.
 *
 * The one real difference is where the subscription hook comes from.
 * `useSyncExternalStore` is **not** exported by `preact/hooks`; it lives in
 * `preact/compat`. Importing it from the wrong one fails at build time rather
 * than silently, which is the good case — but only if the facet names the right
 * module, because the compiler must not know what Preact is.
 *
 * Half of {@link preactFacet}.
 */
export function preactCodegenFacet(options: PreactFacetOptions = {}): CodegenFacet {
  return {
    name: "preact-codegen",
    when: { framework: "preact" },
    concern: "codegen",
    clientReactivityImports: { "preact/compat": ["useSyncExternalStore"] },
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
 * Whether re-running a Preact entry is harmless. It is.
 *
 * This is the one place Preact and React genuinely diverge, and it goes the
 * other way from what the shared JSX surface suggests. React's
 * `createRoot(container)` on a container it already owns mounts a *second* root
 * over the first, so `reactRuntimeFacet` declares `entryReexecutionSafe: false`
 * and pays a full reload on those updates. Preact's `render(vnode, parent)`
 * looks for the previous tree on the container and diffs against it, so a second
 * call replaces rather than duplicates — the case React cannot express.
 *
 * Measured on `examples/preact-basic` before being declared, because assuming it
 * is how the React defect got in. Seven consecutive edits to `src/main.tsx` — the
 * file holding the anchor, so each one re-executes the entry — left exactly one
 * `#center` and one `.counter` on the page. A marker set on `window` beforehand
 * survived every edit, which is what rules out the uninteresting explanation:
 * had Vite full-reloaded instead, the counts would look identical and prove
 * nothing.
 */
export function preactRuntimeFacet(): ZintlFacet {
  return {
    name: "preact-runtime",
    when: { framework: "preact" },
    concern: "runtime",
    priority: 100,
    entryReexecutionSafe: true,
    /**
     * Components read the store through `useSyncExternalStore`, so a delivered
     * catalog redraws them without the entry running again.
     */
    repaintsOnCatalogUpdate: true,
  };
}

/**
 * Full Preact support: {@link preactExtractionFacet}, {@link preactCodegenFacet}
 * and {@link preactRuntimeFacet}.
 *
 * Included in the built-in set when Preact is detected. Detection deliberately
 * prefers Preact over React when both appear, because `@preact/preset-vite`
 * aliases `react` to `preact/compat` — a Preact project has React in its module
 * graph and is not a React project.
 */
export function preactFacet(options: PreactFacetOptions = {}): ZintlFacet[] {
  return [preactExtractionFacet(options), preactCodegenFacet(options), preactRuntimeFacet()];
}
