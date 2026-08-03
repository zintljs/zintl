import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Proposal 024 acceptance criterion 2: **an abandoned boundary is observable.**
 *
 * A catalog that fails to arrive must produce a named failure, not a blank
 * element. This is the defect with the longest tail in the project's history:
 * `_t` returned `""` from three separate places, `loadLazyBoundary` discarded a
 * rejection, an empty result and a synchronous throw, and nothing anywhere
 * recorded any of it — so a boundary could render blank permanently and the
 * only symptom was missing text somebody eventually noticed.
 *
 * It has to be asserted *in the browser*. The one diagnostic that existed was
 * gated on `typeof process !== "undefined"`, which is unfoldable and false in a
 * browser, so this entire failure mode was invisible client-side for the
 * project's whole life while every server-side test passed.
 */
export const deliveryFailureContract: Contract = {
  name: "Delivery Failure",
  description: "Verifies a catalog that fails to arrive is named in the ledger, not silently blank",
  requires: ["spa", "hmr"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    const outcomes = await lab.page.evaluate(async () => {
      const store = (
        globalThis as {
          __zintl_current_instance?: {
            loadLazyBoundary: (id: string, loader: (l: string) => unknown) => unknown;
          };
        }
      ).__zintl_current_instance;
      if (!store) return { ok: false as const, why: "no runtime on the page" };

      // Every abandonment path `loadLazyBoundary` can take.
      await Promise.resolve(
        store.loadLazyBoundary("b_probe_rejects", () => Promise.reject(new Error("404"))),
      ).catch(() => {});
      await Promise.resolve(
        store.loadLazyBoundary("b_probe_empty", () => Promise.resolve(null)),
      ).catch(() => {});
      try {
        store.loadLazyBoundary("b_probe_throws", () => {
          throw new Error("loader exploded");
        });
      } catch {
        return { ok: false as const, why: "a synchronous loader throw escaped loadLazyBoundary" };
      }

      return { ok: true as const };
    });

    if (!outcomes.ok) {
      throw new Error(
        `Could not exercise delivery failure: ${outcomes.why}.\n\n${await lab.assert.describeStall()}`,
      );
    }

    // Give the rejected and empty loaders their microtasks.
    await lab.clock.waitForPaint();

    const ledger = await lab.page.evaluate(
      () =>
        (
          globalThis as {
            __zintl_ledger?: {
              channel: string;
              subject: string;
              outcome: string;
              reason?: string;
            }[];
          }
        ).__zintl_ledger ?? [],
    );

    const failures = ledger.filter((e) => e.outcome === "failed");
    for (const boundary of ["b_probe_rejects", "b_probe_empty", "b_probe_throws"]) {
      const named = failures.find((e) => e.subject.endsWith(`/${boundary}`));
      if (!named) {
        throw new Error(
          `Boundary "${boundary}" failed to deliver and nothing recorded it. A blank element ` +
            `with no trace is the failure mode proposal 024 §1.2 exists to remove — the text is ` +
            `gone either way, but only one of the two can be diagnosed.\n` +
            `  recorded failures: ${JSON.stringify(failures.map((f) => f.subject))}\n\n` +
            `${await lab.assert.describeStall()}`,
        );
      }
      if (!named.reason) {
        throw new Error(
          `Boundary "${boundary}" was recorded as failed but carries no reason. "It failed" and ` +
            `"it resolved empty" call for different fixes.\n\n${await lab.assert.describeStall()}`,
        );
      }
    }

    // The page itself must survive: a failed lazy boundary is not a crash.
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);
  },
};

executeContract(deliveryFailureContract, allManifests);
