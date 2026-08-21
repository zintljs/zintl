/**
 * Framework detection.
 *
 * Part of the orchestration layer: deciding *which* facets a project needs is
 * the plugin's job. Neither the compiler nor the extractor may contain this
 * knowledge.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Framework = "react" | "preact" | "solid" | "vue" | "svelte" | "lit" | "nextjs";

export interface DetectionInput {
  /** Plugin names from the resolved bundler config. */
  pluginNames?: string[];
  /** Project root, scanned for a package.json. */
  root?: string;
}

/**
 * Detect frameworks from bundler plugin names and the project's package.json.
 *
 * Returns an empty array when nothing matched, and that is a real answer: a
 * project with no framework gets the framework-agnostic facets and nothing else.
 *
 * This used to fall back to React, which was not a neutral guess. It gave every
 * framework-less project React extraction and codegen; it made
 * `clientReactivityImports` non-empty for *every* project in existence, so
 * "does this app have reactivity" could not be asked (ledger L-033); and
 * proposal 024 records it blocking a separate fix, because marking React's entry
 * re-execution unsafe would have reached every project that never mentioned
 * React.
 *
 * What the guess was actually carrying was two extraction targets —
 * `obj:field:title` and `obj:field:text` — which are plain object-field
 * extraction with nothing React-specific about them. They now live on the
 * vanilla facet, which applies everywhere, so the guess has nothing left to
 * carry.
 */
export function detectFrameworks({ pluginNames = [], root }: DetectionInput): Framework[] {
  const frameworks = new Set<Framework>();

  /**
   * A plugin name mentions this framework as a *word*, not as a substring.
   *
   * `includes()` is fine for `vue` and `react`, which do not occur inside other
   * plugin names in practice. It is not fine for `solid`: the separator-bounded
   * form is what keeps a name like `splitVendorChunk` from reading as a
   * framework, and the cost of that mistake is a facet activating for a project
   * that never mentioned the framework.
   */
  const mentions = (name: string, framework: string) =>
    new RegExp(`(^|[-/@:.])${framework}($|[-/@:.])`).test(name);

  for (const raw of pluginNames) {
    if (!raw) continue;
    const name = raw.toLowerCase();
    if (name.includes("vue")) frameworks.add("vue");
    if (mentions(name, "preact")) frameworks.add("preact");
    else if (name.includes("react")) frameworks.add("react");
    if (mentions(name, "solid")) frameworks.add("solid");
    if (name.includes("svelte")) frameworks.add("svelte");
    if (name.includes("next") || name.includes("vinext")) frameworks.add("nextjs");
    // Lit has no plugin on either host — it is plain TypeScript with decorators,
    // so there is no name to match and `lit` is detected from dependencies only.
    // A substring test here would have read `splitVendorChunk` as Lit.
  }

  if (root) {
    try {
      const pkgPath = join(root, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        if (allDeps["vue"]) frameworks.add("vue");
        if (allDeps["preact"]) frameworks.add("preact");
        else if (allDeps["react"]) frameworks.add("react");
        if (allDeps["solid-js"]) frameworks.add("solid");
        if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) frameworks.add("svelte");
        if (allDeps["lit"]) frameworks.add("lit");
        if (allDeps["next"] || allDeps["vinext"]) frameworks.add("nextjs");
      }
    } catch {}
  }

  /**
   * Preact wins over React, decided once and after everything has been seen.
   *
   * `@preact/preset-vite` aliases `react` and `react-dom` to `preact/compat`, so
   * a Preact project genuinely has React in its dependency graph *and* usually a
   * React-named plugin beside the Preact one. Resolving as both is not cosmetic:
   * `preact-codegen` and `react-codegen` each claim `.tsx` at priority 100, and
   * `mergeCodegenFacets` throws on that by design.
   *
   * Deciding it here rather than inline is what makes it correct. An `else`
   * inside either scan only orders the two *within one name or one manifest* —
   * a project whose plugin list holds `@preact/preset-vite` and `vite:react-babel`
   * as separate entries still ended up with both, which is precisely the shape a
   * real Preact project has.
   */
  if (frameworks.has("preact")) frameworks.delete("react");

  return Array.from(frameworks);
}
