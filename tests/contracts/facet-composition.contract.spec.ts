import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
function staticFacetNames(root: string, facets: unknown): string[] {
  const src = join(root, "src");
  const ssr = existsSync(src) && readdirSync(src).some((f) => f.startsWith("entry-server."));

  const resolved = resolveFacets(
    assembleFacets({
      frameworks: detectFrameworksOrFallback({ root }),
      ssr,
      facets: (facets as never) ?? ["auto"],
    }),
  );
  return resolved.facets.map((f) => f.name);
}

export const facetCompositionContract: Contract = {
  name: "Facet Composition Fidelity",
  description:
    "Verifies the composition the plugin resolves in a real build matches the golden-file derivation",
  requires: ["build"],

  /**
   * These four fail on a real defect, not on a disagreement about method — see
   * ledger L-011.
   *
   * `viteHostView` derives SSR as
   * `Boolean(config.build?.ssr) || config.ssr !== undefined`. On current Vite the
   * second clause is **always true**, because `ResolvedConfig.ssr` is always a
   * populated object. So every project resolves as SSR, and a plain vanilla SPA
   * gets `ssr-wrapping` and `ssr-runtime`.
   *
   * It is latent rather than shipped: `getRuntimeCode` gates `store-server.js` on
   * `isSsr` again at codegen time, so no server runtime reaches a client bundle
   * (verified against the committed `vanilla-spa-basic` build snapshots). The
   * capability flags lie, and "nothing ships that isn't used" is being upheld by
   * the second gate rather than the first.
   *
   * Left pending rather than fixed because the correct heuristic is a genuine
   * design question: dropping the clause makes `build.ssr` the only signal, which
   * is right for builds and wrong for SSR **dev**, where nothing in the config
   * distinguishes an SSR project. That decision wants its own change and its own
   * evidence from the hydration and ssr-isolation contracts.
   *
   * The SSR manifests pass, and so does `rsbuild-spa` — on the Rspack path
   * `nativeHostView` reports `isSsr: false` and the derivations agree.
   */
  pendingFor: {
    "react-basic": "L-011 — viteHostView reports isSsr:true for every project",
    "vue-basic": "L-011 — viteHostView reports isSsr:true for every project",
    "svelte-basic": "L-011 — viteHostView reports isSsr:true for every project",
    "vanilla-spa-basic": "L-011 — viteHostView reports isSsr:true for every project",
  },
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

    const live: string[] = ctx!.compiler._resolved.facets.map((f: { name: string }) => f.name);
    const predicted = staticFacetNames(lab.root, manifest.zintlOptions.facets);

    expect(
      [...live].sort(),
      `Live composition for ${manifest.name} differs from the golden-file derivation.\n` +
        `  live:      ${live.join(", ")}\n` +
        `  predicted: ${predicted.join(", ")}`,
    ).toEqual([...predicted].sort());
  },
};

executeProjectContract(facetCompositionContract, allManifests);
