import { expect } from "vite-plus/test";
import { executeProjectContract, type Contract } from "@zintljs/testing";
import { assembleFacets, detectFrameworksOrFallback, resolveFacets } from "zintljs/facets";
import { allManifests } from "../manifests/index.js";

/**
 * Does the plugin actually resolve the composition the golden files claim?
 *
 * `packages/zintl/src/__tests__/facets/composition.test.ts` snapshots the
 * resolved facet set for all 19 example applications, which is the breadth the
 * §8 guardrail needs — contracts run against manifests, and eleven example apps
 * have none, including every MPA and the only Next/vinext project.
 *
 * But that file derives its own inputs. It guesses SSR from the presence of an
 * `entry-server.*` file and passes only `root` to detection, where the plugin
 * builds a `BundlerHostView` from Vite's resolved config — reading
 * `config.build.ssr` and the names of every other plugin. Two derivations of the
 * same thing, and nothing made them agree.
 *
 * So this is the fidelity half: fewer projects, but the **real** path. It runs a
 * genuine production build, then reads the composition off the compiler the
 * plugin itself constructed. Breadth from the golden files, fidelity from here.
 *
 * A failure means the golden files are describing a world the plugin does not
 * live in, which makes them worse than no guard at all.
 */

/** Same derivation the golden files use, deliberately duplicated so it can disagree. */
function staticFacetNames(root: string, facets: unknown, ssr: boolean, bundler: string): string {
  const resolved = resolveFacets(
    assembleFacets({
      frameworks: detectFrameworksOrFallback({ root }),
      bundler,
      root,
      ssr,
      facets: facets as never,
    }),
  );
  return resolved.facets
    .map((f) => f.name)
    .sort()
    .join(", ");
}

export const facetCompositionContract: Contract = {
  name: "Facet Composition Fidelity",
  description:
    "Verifies the composition the plugin resolves in a real build matches the golden-file derivation",
  requires: ["build"],

  async execute(lab, adapter, manifest) {
    // The build is what makes the plugin run its real config path; it is cached
    // per project, so the cost here is shared with the Production Build contract.
    await lab.pipeline.build();

    const contexts =
      (globalThis as unknown as { __zintl_active_contexts?: { compiler?: any }[] })
        .__zintl_active_contexts ?? [];
    const ctx = contexts.find((c) => c.compiler?.rootDir === lab.root);

    expect(
      ctx,
      `No active Zintl context rooted at ${lab.root}. Either the build did not run the plugin, ` +
        `or the compiler was constructed with a different root — which is itself the defect ` +
        `this contract exists to catch (ledger L-008).`,
    ).toBeDefined();

    /**
     * Compared as a *set membership*, not an equality, because SSR-ness is a
     * property of the build target rather than of the project.
     *
     * An SSR app has two compositions: its client build carries no SSR facets —
     * nothing about wrapping a server entry belongs in a browser bundle — and
     * its server build does. Which one a given context holds depends on which
     * target ran, and builds are cached per target, so pinning one is brittle.
     * Every composition the plugin actually produced must simply be one of the
     * two the golden files predict.
     */
    const live = ctx!.compiler._resolved.facets
      .map((f: { name: string }) => f.name)
      .sort()
      .join(", ");

    // The host matters to composition now that bundler facets self-activate,
    // and the manifest is the only thing that knows which driver ran.
    const bundler = manifest.driver === "rsbuild" ? "rspack" : "vite";
    const predicted = [
      staticFacetNames(lab.root, manifest.zintlOptions.facets, false, bundler),
      staticFacetNames(lab.root, manifest.zintlOptions.facets, true, bundler),
    ];

    expect(
      predicted,
      `Live composition for ${manifest.name} matches neither predicted variant.\n` +
        `  live:            ${live}\n` +
        `  predicted (spa): ${predicted[0]}\n` +
        `  predicted (ssr): ${predicted[1]}`,
    ).toContain(live);
  },
};

executeProjectContract(facetCompositionContract, allManifests);
