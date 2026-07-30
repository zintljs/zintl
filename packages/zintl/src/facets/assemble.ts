/**
 * Facet assembly — turning detected frameworks and user input into a flat facet
 * list, ready for resolution.
 *
 * This is the one place that decides which facets a project gets. Every
 * previously-implicit default now lives here, in the open:
 *
 * - the `"auto"` sentinel expands to the detected framework set plus baselines;
 * - `vanillaFacet`, `htmlFacet` and `assetsFacet` are always part of `"auto"`;
 * - `clientSpaFacet` is added unless the project is Next.js;
 * - `ssrFacet` is added for SSR builds that are not Next.js;
 * - `viteFacet` is always appended, and cannot be opted out of.
 */
import {
  assetsFacet,
  clientSpaFacet,
  htmlFacet,
  nextjsFacet,
  reactFacet,
  ssrFacet,
  svelteFacet,
  vanillaFacet,
  viteFacet,
  vueFacet,
} from "@zintl/compiler/facets";
import type { AssetTargetConfig, ZintlFacet } from "@zintl/compiler";
import type { FacetsInput } from "../types.js";
import type { Framework } from "./detect.js";

export interface AssembleInput {
  /** Frameworks detected for this project. */
  frameworks: Framework[];
  /** Whether this build targets SSR. */
  ssr?: boolean;
  /** User-declared facets; defaults to `["auto"]`. */
  facets?: FacetsInput[];
  /** Asset facet configuration drawn from plugin options. */
  assetsTarget?: (string | AssetTargetConfig)[];
  virtualAssets?: boolean;
}

/**
 * The facet set that `"auto"` expands to.
 */
export function autoFacets(input: AssembleInput): ZintlFacet[] {
  const { frameworks, ssr = false, assetsTarget, virtualAssets } = input;
  const out: unknown[] = [];

  for (const f of frameworks) {
    if (f === "vue") out.push(vueFacet());
    else if (f === "react") out.push(reactFacet());
    else if (f === "svelte") out.push(svelteFacet());
    else if (f === "nextjs") out.push(reactFacet(), nextjsFacet());
  }

  const isNext = frameworks.includes("nextjs");

  // Next.js brings its own SSR + runtime facets; adding the generic ones would
  // collide on ssr.wrapCode at the same priority.
  if (ssr && !isNext) out.push(ssrFacet());
  if (!isNext) out.push(clientSpaFacet());

  out.push(vanillaFacet(), htmlFacet(), assetsFacet({ targets: assetsTarget, virtualAssets }));

  return out.flat(Infinity) as ZintlFacet[];
}

/**
 * Flatten user facet input, expanding `"auto"`, thunks and nested arrays.
 */
export function flattenFacets(inputs: FacetsInput[], auto: ZintlFacet[]): ZintlFacet[] {
  const result: ZintlFacet[] = [];

  function processInput(input: unknown): void {
    if (!input) return;
    if (input === "auto") {
      for (const f of auto) processInput(f);
      return;
    }
    if (typeof input === "function") {
      processInput((input as () => unknown)());
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) processInput(item);
      return;
    }
    if (typeof input === "object") {
      result.push(input as ZintlFacet);
      return;
    }
  }

  for (const input of inputs) processInput(input);

  return result;
}

/**
 * The complete facet list for a project: user input (with `"auto"` expanded)
 * plus the always-injected Vite bundler facet.
 */
export function assembleFacets(input: AssembleInput): ZintlFacet[] {
  const facets = flattenFacets(input.facets ?? ["auto"], autoFacets(input));

  // The Vite bundler facet is always present — the plugin cannot function
  // without its virtual-path, dynamic-import and HMR hooks.
  facets.push(viteFacet());

  return facets;
}
