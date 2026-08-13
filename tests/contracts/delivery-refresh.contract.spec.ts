import { executeContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * A load in flight supersedes a catalog already present (`docs/spec/ZDB.md` §2).
 *
 * The receiver has two ways in. `registerLoader` **pushes** — a generated
 * manager module calls it as it evaluates, and for a lazily-loaded locale the
 * load it starts is asynchronous. `loadLazyBoundary` **pulls** — it is what
 * `zintl()` goes through. Both can be running for the same boundary at the same
 * time, and on a host that re-executes the manager and the entry as separate
 * modules they routinely are.
 *
 * The rule this asserts is that the pull path must **join** an outstanding push
 * rather than answer from what it already has. A load is outstanding precisely
 * because something decided the present catalog needs replacing, so serving the
 * present one is choosing the older of two known states — the inverse of Axiom
 * D1, arrived at by a different route than `delivery-ordering` covers.
 *
 * **Why this contract exists.** It was a real defect, found by hand on
 * `rsbuild-spa` and then pinned down deterministically: `loadLazyBoundary`
 * checked "already loaded" *before* "already loading", so it returned in zero
 * milliseconds with the stale catalog while the fresh one was still in the air.
 * The visible symptom was the worst kind — a permanently blank heading, because
 * Zintl has no source-locale fallback and every key that existed only in the
 * incoming catalog resolved to `""`. Nothing re-rendered afterwards, so the page
 * stayed blank until the next edit.
 *
 * Driven through the store rather than through a file edit, deliberately. The
 * defect is a race, and a contract that waits for a race to land is a contract
 * that passes while broken. This makes the interleaving happen on purpose, so it
 * is a guarantee rather than a sighting.
 */
export const deliveryRefreshContract: Contract = {
  name: "Delivery Refresh",
  description:
    "Verifies a pull for a boundary joins a push already loading it, instead of serving stale",
  requires: ["spa", "hmr"],
  async execute(lab, adapter) {
    await adapter.navigateHome(lab);
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    const result = await lab.page.evaluate(
      async ({ key: messageKey }) => {
        const store = (
          globalThis as {
            __zintl_current_instance?: {
              locale: string;
              catalogs: Record<string, Record<string, Record<string, unknown>>>;
              registerLoader: (b: string, l: (locale: string) => unknown) => unknown;
              loadLazyBoundary: (b: string, l: (locale: string) => unknown) => unknown;
            };
          }
        ).__zintl_current_instance;
        if (!store) return { ok: false as const, why: "no runtime on the page" };

        const locale = store.locale;
        const boundary = Object.keys(store.catalogs[locale] ?? {}).find(
          (b) => messageKey in (store.catalogs[locale]?.[b] ?? {}),
        );
        if (!boundary) {
          return { ok: false as const, why: `no boundary carries ${JSON.stringify(messageKey)}` };
        }

        const FRESH = "__zintl_refresh_probe__";
        const present = store.catalogs[locale][boundary];

        /**
         * Slow enough that "returned without waiting" and "waited for the load"
         * cannot be confused, and shaped like a real loader: `BoundaryCatalogs`,
         * keyed by boundary id rather than a flat message map.
         */
        const slowLoader = () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ [boundary]: { ...present, [FRESH]: "fresh" } }), 250),
          );

        // The push, as a re-executing manager module would issue it.
        store.registerLoader(boundary, slowLoader);

        // The pull, as a re-executing entry would issue it, while that is open.
        const startedAt = Date.now();
        await store.loadLazyBoundary(boundary, slowLoader);
        const waitedMs = Date.now() - startedAt;

        return {
          ok: true as const,
          boundary,
          waitedMs,
          sawFresh: FRESH in (store.catalogs[locale]?.[boundary] ?? {}),
        };
      },
      { key: adapter.initialHeadingText },
    );

    if (!result.ok) {
      throw new Error(
        `Could not exercise refresh: ${result.why}.\n\n${await lab.assert.describeStall()}`,
      );
    }

    if (!result.sawFresh) {
      throw new Error(
        `A pull for "${result.boundary}" returned after ${result.waitedMs}ms without the catalog ` +
          `that was already loading for it. The caller was handed the stale one, so every key the ` +
          `incoming catalog was about to supply resolves to "" — and with no source-locale ` +
          `fallback that renders as blank text which nothing later repairs.\n\n` +
          `${await lab.assert.describeStall()}`,
      );
    }
  },
};

executeContract(deliveryRefreshContract, allManifests);
