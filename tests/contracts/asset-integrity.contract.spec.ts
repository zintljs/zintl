import { expect } from "vite-plus/test";
import {
  executeProjectContract,
  localizedAssetPath,
  type AssetsAdapter,
  type Contract,
} from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * An artifact with no bytes stops the build (proposal 035 §6).
 *
 * The `assets` contract proves a filled artifact reaches the browser. This
 * proves the opposite half: an unfilled one never gets that far. Neither implies
 * the other, and for a long time only the first held — Zintl wrote a
 * byte-identical copy of the source into every localized path, `verifyIntegrity`
 * skipped `b_assets` outright, and a German page shipped English while the build
 * said nothing.
 *
 * That is the shape this exists to make impossible: not "a missing translation
 * renders blank", which is loud, but **a missing translation renders the source
 * locale**, which is silent and looks like success.
 *
 * Emptying rather than deleting is deliberate. A deleted artifact is
 * re-scaffolded on the next discovery pass, so both routes converge on the same
 * state — but emptying tests the state the compiler actually produces for a slot
 * nobody has filled, which is the one a real project meets.
 */
export const assetIntegrityContract: Contract<AssetsAdapter> = {
  name: "Asset Integrity",
  description: "Verifies an unfilled localized artifact fails the build",
  requires: ["asset-integrity"],
  async execute(lab, adapter, manifest) {
    if (!adapter.assetFile) {
      throw new Error(
        `This project claims "asset-integrity" without declaring "assetFile". The capability is ` +
          `the claim that the adapter can say which artifact to empty; claiming it without saying ` +
          `is the one state the capability model cannot express.`,
      );
    }

    /**
     * `outputDir` comes from the manifest rather than from a running compiler:
     * a project lab never starts a dev server, so there is none to ask.
     */
    const artifact = localizedAssetPath(
      lab,
      adapter.assetFile,
      "ar",
      manifest.zintlOptions.outputDir,
    );
    const authored = await lab.fs.read(artifact);
    expect(authored, `${artifact} is already empty — this project cannot answer`).not.toBe("");

    await lab.fs.write(artifact, "");

    /**
     * Uncached, both times.
     *
     * Builds are memoised per worker by project and overrides, which is right
     * for the contracts that build an unchanged project — and wrong for this
     * one twice over. The second build would be handed the first one's
     * rejection, and the first would leave a build of a deliberately broken
     * tree in the memo for whatever built this project next.
     */
    const failure = await lab.pipeline.build({}, { cache: false }).then(
      () => undefined,
      (error: Error) => error,
    );

    expect(failure, "an empty artifact built successfully").toBeDefined();
    const message = failure!.message;

    expect(message).toContain("[Zintl Integrity Error]");
    expect(message).toContain("unfilled localized asset");
    // The path to fill, spelled out. A count alone sends somebody hunting.
    expect(message).toContain(artifact.split("/").pop());

    /**
     * Both remedies, because the second is an answer rather than an escape.
     * Targeting an asset *is* the declaration that it varies by locale, so
     * "stop targeting it" is correct and complete for anybody who discovers
     * theirs never did.
     */
    expect(message).toContain("fill the files above");
    expect(message).toContain("stop targeting the asset");

    // And the same project builds once the slot is filled again — so the gate
    // is reacting to the emptiness, not to anything else the edit disturbed.
    await lab.fs.write(artifact, authored);
    await expect(lab.pipeline.build({}, { cache: false })).resolves.toBeDefined();
  },
};

executeProjectContract(assetIntegrityContract, allManifests);
