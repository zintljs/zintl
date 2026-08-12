/**
 * Framework detection.
 *
 * Part of the orchestration layer: deciding *which* facets a project needs is
 * the plugin's job. Neither the compiler nor the extractor may contain this
 * knowledge.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Framework = "react" | "vue" | "svelte" | "nextjs";

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

  for (const raw of pluginNames) {
    if (!raw) continue;
    const name = raw.toLowerCase();
    if (name.includes("vue")) frameworks.add("vue");
    if (name.includes("react")) frameworks.add("react");
    if (name.includes("svelte")) frameworks.add("svelte");
    if (name.includes("next") || name.includes("vinext")) frameworks.add("nextjs");
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
        if (allDeps["react"]) frameworks.add("react");
        if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) frameworks.add("svelte");
        if (allDeps["next"] || allDeps["vinext"]) frameworks.add("nextjs");
      }
    } catch {}
  }

  return Array.from(frameworks);
}
