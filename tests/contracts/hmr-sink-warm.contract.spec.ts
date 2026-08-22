import { executeContract, type Contract, type HmrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { insert } from "./structural-edit.js";

/**
 * The same edit `HMR Sink` makes, and the guarantee that contract cannot make:
 * it arrives warm.
 *
 * Separate from `HMR Sink` rather than branched inside it, because which
 * projects can promise this is a **manifest** question and the suite answers
 * manifest questions by selection. A contract that read a capability and
 * branched on it would be doing the runner's job in the wrong place, and would
 * be the first per-project conditional in this directory.
 *
 * That separation was already true when the two shared a file — what moved them
 * apart on disk was cost. See the note in `hmr-sink.contract.spec.ts`.
 */
export const hmrSinkWarmContract: Contract<HmrAdapter> = {
  name: "HMR Sink Warm",
  description: "Verifies adding a new sink is absorbed without a full page reload",
  requires: ["hmr", "hmr-structural", "hmr-warm"],
  async execute(lab, adapter) {
    const { addSink } = adapter;
    if (!addSink) {
      throw new Error(
        `This project claims "hmr-structural" without declaring "addSink". The capability is ` +
          `exactly the claim that it can describe that edit.`,
      );
    }

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    const capture = lab.ws.capture();
    await insert(lab, addSink, "addSink");

    if (addSink.expectText) {
      await lab.assert.textEventually(
        addSink.selector ?? adapter.headingSelector,
        addSink.expectText,
      );
    } else {
      await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
    }

    const packets = capture.stop();
    if (packets.some((p) => p.type === "full-reload")) {
      throw new Error(
        `Adding a sink to ${addSink.file} reloaded the page, on a project claiming "hmr-warm". ` +
          `ZHMR §4.1 lists "a sink is added or removed without changing the boundary hierarchy" ` +
          `among the Fast Replacement triggers — the boundary already exists, so only its ` +
          `content changed.\n\n` +
          `Packets: ${packets.map((p) => p.type).join(", ")}`,
      );
    }
  },
};

executeContract(hmrSinkWarmContract, allManifests);
