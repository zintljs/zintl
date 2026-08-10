import { expect } from "vite-plus/test";
import { executeProjectContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * L-022's fence: multiplex on a bundler with no HTML fan-out fails fast with a
 * clear Zintl error, instead of the opaque `html-rspack-plugin` loader-chain
 * crash the ledger documents.
 *
 * `["multiplex-fenced"]` selects exactly the one fixture built for this — a
 * real `zintljs/rsbuild` build, since `compileWithZintl` (which backs the
 * `"transform"`/`"graph"` capabilities) constructs `ZintlCompiler` directly
 * and never goes through `ensureCompiler`, so it would never reach the fence
 * at all. Deliberately not `"build"` too: that capability means "a normal
 * production build succeeds", which is the opposite of what this fixture
 * proves — see the manifest's own comment.
 */
export const multiplexFenceContract: Contract<any> = {
  name: "Multiplex HTML Fan-out Fence",
  description:
    "Combining multiplex with a bundler that has no HTML fan-out facet fails fast with a clear " +
    "Zintl error, rather than the opaque host crash documented as ledger L-022.",
  requires: ["multiplex-fenced"],
  async execute(lab) {
    await expect(lab.pipeline.build()).rejects.toThrow(/\[Zintl\] Multiplex is not supported/);
  },
};

executeProjectContract(multiplexFenceContract, allManifests);
