import type { CodegenFacet, ZintlFacet, TargetDescriptor } from "@zintljs/compiler";
import { convertToHtmlTemplate, JSX_TARGETS, serializeTags } from "./jsx.js";

export interface SolidFacetOptions {
  /**
   * Replace the JSX attributes and object fields scanned for strings.
   *
   * Replaces the defaults rather than adding to them — pass a full list.
   *
   * @default the shared JSX target set
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
 * Extraction for Solid files.
 *
 * The same JSX surface as React and Preact — Solid's difference is entirely in
 * what its compiler *does* with JSX, not in how JSX is written. Half of
 * {@link solidFacet}.
 */
export function solidExtractionFacet(options: SolidFacetOptions = {}): ZintlFacet {
  return {
    name: "solid-extraction",
    when: { framework: "solid" },
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [...JSX_TARGETS]) as TargetDescriptor[],
    extensions: options.extensions || [".tsx", ".jsx"],
  };
}

/**
 * Codegen for Solid: rich-text output and a reactive dependency on the store.
 *
 * **Why `reactiveBridge` and not `clientReactivityImports`.** React and Preact
 * re-run a component function when a hook tells them to, so subscribing the
 * component is enough. Solid never re-runs a component: it compiles JSX into
 * fine-grained effects, and an effect re-runs only when a signal *it read during
 * its last run* changes. `_t('…')` is an ordinary call to an ordinary function,
 * so a Solid component can be perfectly subscribed and still never update — the
 * same trap Vue's bridge docblock describes, arrived at from the opposite
 * direction.
 *
 * So the bridge contributes both halves: `setup` mirrors the store into a
 * signal, and `read` is spliced into every generated `_t` call, which makes
 * rendering a translation *be* a read of that signal. The dependency is recorded
 * by construction, for every sink, without the codegen having to find them.
 *
 * **Module scope is correct here, not a shortcut.** The store is a module-level
 * singleton, so one signal mirroring it is the right cardinality, it outlives
 * every component that reads it, and it needs no disposal — which is just as
 * well, since `onCleanup` outside a reactive root warns. Vue needs
 * `onScopeDispose` because its handle is per-component; Solid's is not.
 *
 * Half of {@link solidFacet}.
 */
export function solidCodegenFacet(options: SolidFacetOptions = {}): CodegenFacet {
  return {
    name: "solid-codegen",
    when: { framework: "solid" },
    concern: "codegen",
    priority: 100,
    extensions: options.extensions || [".tsx", ".jsx"],
    match: (filePath: string) => filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
    reactiveBridge: {
      /**
       * The framework import is written here rather than declared for the
       * pipeline to place, matching Vue's reasoning: where an import may legally
       * sit is a property of the dialect.
       */
      setup: [
        'import { createSignal as __zintl_createSignal } from "solid-js";',
        "const [__zintl_v, __zintl_set_v] = __zintl_createSignal(getStoreVersion());",
        "subscribe(() => __zintl_set_v(getStoreVersion()));",
      ].join("\n"),
      read: "__zintl_v()",
    },
    /**
     * `innerHTML`, not `dangerouslySetInnerHTML` — Solid takes the plain DOM
     * property name. `display: contents` keeps the wrapper out of the layout,
     * the same trick React's facet uses for the same reason.
     */
    wrapJsxRichText: (replacement: string): string => {
      return `<span style={{ display: "contents" }} innerHTML={${replacement}} />`;
    },
    serializeTags,
    convertToHtmlTemplate,
  };
}

/**
 * Whether re-running a Solid entry is harmless. It is not.
 *
 * `render(code, element)` appends its result and hands back a dispose function;
 * calling it again on the same element renders the application a second time
 * beside the first rather than replacing it. That is the same shape as Svelte's
 * `mount()`, and it gets the same declaration.
 *
 * Measured rather than reasoned: called twice on one element in a browser,
 * `render` leaves **two** children, not one. Worth having as a number, because
 * Preact's `render` — the same word, the same shape of call — replaces, and this
 * facet would be wrong if it had inherited that assumption.
 *
 * **A correction, kept rather than quietly dropped.** This paragraph used to say
 * that a Solid component "does not self-accept a catalog invalidation, so the
 * invalidation reaches the entry", and that a catalog edit therefore arrives by
 * reload. That was wrong on both counts, and it was written confidently enough
 * to be worth naming.
 *
 * What actually happened is that the applier invalidated a boundary's own source
 * module on a catalog update, and in `examples/solid-basic` the edited string's
 * boundary *is* the file calling `zintl()` — so the anchor file's injected
 * handler declined, which bubbles to a reload. Nothing about Solid's acceptance
 * behaviour was involved. The edge belonged to any non-replayable framework the
 * moment a translatable string shared a file with an anchor, and it is fixed in
 * `packages/zintl/src/hmr/vite.ts`: a catalog update no longer needs the source
 * to re-execute where the file itself can repaint from the store.
 *
 * `entryReexecutionSafe: false` above is unaffected and still correct — the
 * measurement behind it stands. What changed is that a *catalog* update no
 * longer asks the mount to run again at all.
 */
export function solidRuntimeFacet(): ZintlFacet {
  return {
    name: "solid-runtime",
    when: { framework: "solid" },
    concern: "runtime",
    priority: 100,
    entryReexecutionSafe: false,
    /**
     * A delivered catalog bumps the store version, the bridge signal follows it,
     * and every effect that rendered a translation re-runs. Nothing needs the
     * entry to execute again.
     */
    repaintsOnCatalogUpdate: true,
  };
}

/**
 * Full Solid support: {@link solidExtractionFacet}, {@link solidCodegenFacet}
 * and {@link solidRuntimeFacet}.
 *
 * Included in the built-in set when Solid is detected.
 */
export function solidFacet(options: SolidFacetOptions = {}): ZintlFacet[] {
  return [solidExtractionFacet(options), solidCodegenFacet(options), solidRuntimeFacet()];
}
