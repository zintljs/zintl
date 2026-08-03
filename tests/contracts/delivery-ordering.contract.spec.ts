import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * Axiom D1, asserted in a real browser (`docs/spec/ZDB.md` §2).
 *
 * `hmr-hammer` proves the *happy* direction — the last write wins — but it can
 * only ever observe the order the network happened to produce. It cannot make
 * an older catalog arrive after a newer one, so it never tests the rule that
 * makes convergence structural rather than lucky: **an older delivery must
 * lose, even when it arrives last.**
 *
 * This drives the receiver directly, which is the point. The unit tests cover
 * the same rule against a bare `I18nStore`; what they cannot cover is the
 * runtime as it is actually *served* — text-substituted through
 * `getRuntimeCode`, with `__ZINTL_DEV__` resolved, inside the page. That
 * distinction is not academic: an unfoldable guard once disabled every
 * development branch in the browser for the project's entire life, and every
 * unit test still passed.
 */
export const deliveryOrderingContract: Contract = {
  name: "Delivery Ordering",
  description:
    "Verifies a catalog arriving after a newer one is discarded by sequence, not applied",
  requires: ["spa", "hmr"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    // The key a catalog is addressed by is the source text itself.
    const key = adapter.initialHeadingText;

    const applied = await lab.page.evaluate(
      ({ key: messageKey }) => {
        const store = (
          globalThis as {
            __zintl_current_instance?: {
              locale: string;
              catalogs: Record<string, Record<string, Record<string, unknown>>>;
              addCatalogs: (c: unknown, seq?: number) => void;
            };
          }
        ).__zintl_current_instance;
        if (!store) return { ok: false as const, why: "no runtime on the page" };

        const locale = store.locale;
        const boundaries = Object.keys(store.catalogs[locale] ?? {}).filter(
          (b) => messageKey in (store.catalogs[locale]?.[b] ?? {}),
        );
        if (boundaries.length === 0) {
          return { ok: false as const, why: `no boundary carries ${JSON.stringify(messageKey)}` };
        }

        /**
         * A generation comfortably above anything the compiler has issued, so
         * the "newer" delivery cannot itself be superseded by a real one
         * arriving mid-test.
         */
        const newer = 1_000_000;
        const older = newer - 1;

        for (const boundary of boundaries) {
          store.addCatalogs({ [locale]: { [boundary]: { [messageKey]: "NEWER" } } }, newer);
        }
        for (const boundary of boundaries) {
          store.addCatalogs({ [locale]: { [boundary]: { [messageKey]: "OLDER" } } }, older);
        }
        return { ok: true as const, boundaries };
      },
      { key },
    );

    if (!applied.ok) {
      throw new Error(
        `Could not exercise ordering: ${applied.why}.\n\n${await lab.assert.describeStall()}`,
      );
    }

    /**
     * Assert on the *store*, not the DOM.
     *
     * D1 governs what the receiver applies. Whether a framework then re-renders
     * is a different question with its own contracts (`hmr`, `locale-switch`),
     * and asserting it here would couple this to every framework's reactivity
     * and report their failures as ordering failures.
     */
    const value = await lab.page.evaluate(
      ({ key: messageKey, boundaries }) => {
        const store = (
          globalThis as {
            __zintl_current_instance?: {
              locale: string;
              catalogs: Record<string, Record<string, Record<string, unknown>>>;
            };
          }
        ).__zintl_current_instance;
        return store?.catalogs[store.locale]?.[boundaries[0]]?.[messageKey];
      },
      { key, boundaries: applied.boundaries },
    );

    if (value !== "NEWER") {
      throw new Error(
        `The older catalog arrived last and won: the store holds ${JSON.stringify(value)}, ` +
          `expected "NEWER". Ordering is being decided by arrival rather than by sequence, ` +
          `which is the defect Axiom D1 exists to make impossible.\n\n` +
          `${await lab.assert.describeStall()}`,
      );
    }

    /**
     * And it must have lost *by rule*, not by accident. A receiver that happened
     * to ignore the second write for some unrelated reason would pass the check
     * above while providing none of the guarantee.
     */
    const ledger = await lab.page.evaluate(
      () =>
        (
          globalThis as {
            __zintl_ledger?: {
              channel: string;
              subject: string;
              seq: number;
              outcome: string;
              reason?: string;
            }[];
          }
        ).__zintl_ledger ?? [],
    );

    const superseded = ledger.find(
      (e) => e.channel === "runtime/catalog" && e.outcome === "superseded" && e.seq === 999_999,
    );
    if (!superseded) {
      throw new Error(
        `The store holds the newer value, but the older delivery was not recorded as ` +
          `superseded. A correct result reached by accident is indistinguishable from one ` +
          `reached by rule, and only the second survives the next change.\n\n` +
          `${await lab.assert.describeStall()}`,
      );
    }
  },
};

executeContract(deliveryOrderingContract, allManifests);
