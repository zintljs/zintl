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

/** The framework assumed when detection finds nothing. */
export const FALLBACK_FRAMEWORK: Framework = "react";

export interface DetectionInput {
  /** Plugin names from the resolved bundler config. */
  pluginNames?: string[];
  /** Project root, scanned for a package.json. */
  root?: string;
}

/**
 * Detect frameworks from bundler plugin names and the project's package.json.
 *
 * Returns an empty array when nothing matched — callers decide whether to apply
 * {@link FALLBACK_FRAMEWORK}, so the guess stays visible rather than buried.
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

/** Detect, falling back to {@link FALLBACK_FRAMEWORK} when nothing matched. */
export function detectFrameworksOrFallback(input: DetectionInput): Framework[] {
  const detected = detectFrameworks(input);
  return detected.length > 0 ? detected : [FALLBACK_FRAMEWORK];
}
