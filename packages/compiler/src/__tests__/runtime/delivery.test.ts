/**
 * The runtime half of the delivery axioms (`docs/spec/ZDB.md`).
 *
 * The compiler's `DeliveryBus` has its own tests; this file covers the second,
 * separate implementation that lives in the runtime because runtime modules are
 * served as text and cannot import from the compiler's module graph. Two
 * implementations of one specification is exactly the situation where the
 * specification has to be asserted on both sides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { I18nStore, globalRegistry } from "../../runtime/store.js";

interface LedgerEntry {
  channel: string;
  subject: string;
  seq: number;
  outcome: string;
  reason?: string;
}

const scope = globalThis as { __zintl_version?: number; __zintl_ledger?: LedgerEntry[] };
const ledger = () => scope.__zintl_ledger ?? [];
const beacon = () => scope.__zintl_version ?? 0;

describe("runtime delivery", () => {
  beforeEach(() => {
    scope.__zintl_ledger = [];
    scope.__zintl_version = 0;
    globalRegistry.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalRegistry.clear();
    vi.restoreAllMocks();
  });

  describe("Axiom D1 — a newer change wins", () => {
    it("supersedes a locale switch that a later one overtook", async () => {
      // Two switches overlap and the *earlier* one finishes last. Before the
      // envelope, whichever set of promises settled last decided the outcome —
      // so the final state was a function of network timing.
      const store = new I18nStore();
      store.locales = ["ar", "fr"];

      let releaseAr!: (v: unknown) => void;
      let releaseFr!: (v: unknown) => void;
      globalRegistry.set("b1", ((locale: string) =>
        locale === "ar"
          ? new Promise((r) => (releaseAr = r))
          : new Promise((r) => (releaseFr = r))) as never);

      const first = store.setLocale("ar");
      const second = store.setLocale("fr");

      releaseFr({ b1: { hi: "bonjour" } });
      await second;
      releaseAr({ b1: { hi: "مرحبا" } });
      await first;

      const locales = ledger().filter((e) => e.channel === "runtime/locale");
      expect(locales.map((e) => e.outcome)).toEqual(["applied", "superseded"]);
      expect(store.locale).toBe("fr");
    });

    it("discards a catalog that arrives after a newer generation", () => {
      const store = new I18nStore();
      store.addCatalogs({ ar: { b1: { hi: "new" } } }, 6);
      store.addCatalogs({ ar: { b1: { hi: "old" } } }, 5);

      expect(store.catalogs["ar"]?.["b1"]?.["hi"]).toBe("new");
    });

    it("converges on the newest generation whatever the arrival order", () => {
      // This is the `hmr-hammer` mechanism at the catalog level: five edits,
      // delivered in the worst order the network can produce. The final state
      // is the newest generation *by construction* — an out-of-order arrival is
      // discarded by number, so it cannot win a race it never entered.
      for (const arrival of [
        [1, 2, 3, 4, 5],
        [5, 4, 3, 2, 1],
        [3, 1, 5, 2, 4],
        [2, 5, 1, 4, 3],
      ]) {
        const store = new I18nStore();
        for (const generation of arrival) {
          store.addCatalogs({ ar: { b1: { hi: `v${generation}` } } }, generation);
        }
        expect(store.catalogs["ar"]?.["b1"]?.["hi"]).toBe("v5");
      }
    });

    it("applies a catalog with no generation, having nothing to compare", () => {
      // A loader hands back a catalog with no upstream sequence. There is
      // nothing to order against, so ordering must not silently reject it.
      const store = new I18nStore();
      store.addCatalogs({ ar: { b1: { hi: "from a loader" } } });

      expect(store.catalogs["ar"]?.["b1"]?.["hi"]).toBe("from a loader");
    });

    it("orders catalogs per locale and boundary, not globally", () => {
      // A boundary's Arabic and French catalogs are separate deliveries; one
      // must not be able to supersede the other.
      const store = new I18nStore();
      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } }, 9);
      store.addCatalogs({ fr: { b1: { hi: "bonjour" } } }, 1);
      store.addCatalogs({ ar: { b2: { hi: "أهلا" } } }, 1);

      expect(store.catalogs["fr"]?.["b1"]?.["hi"]).toBe("bonjour");
      expect(store.catalogs["ar"]?.["b2"]?.["hi"]).toBe("أهلا");
    });

    it("keys the locale channel on one subject, not one per locale", () => {
      // A switch to "fr" and a switch to "ar" contest the same thing — the
      // store's active-locale slot. Keying by target locale would let them run
      // as unrelated deliveries, which is the interleaving this prevents.
      const store = new I18nStore();
      void store.setLocale("ar");
      void store.setLocale("fr");

      const subjects = new Set(
        ledger()
          .filter((e) => e.channel === "runtime/locale")
          .map((e) => e.subject),
      );
      expect([...subjects]).toEqual(["active"]);
    });
  });

  describe("Axiom D2 — nothing disappears without a name", () => {
    it("names an empty loader result instead of abandoning the boundary", async () => {
      const store = new I18nStore();
      store.locale = "ar";
      await store.loadLazyBoundary("b_empty", (() => Promise.resolve(null)) as never);

      expect(ledger()).toContainEqual(
        expect.objectContaining({
          channel: "runtime/catalog",
          subject: "ar/b_empty",
          outcome: "failed",
          reason: "loader resolved empty",
        }),
      );
    });

    it("names a rejected load", async () => {
      const store = new I18nStore();
      store.locale = "ar";
      await store.loadLazyBoundary("b_reject", (() => Promise.reject(new Error("404"))) as never);

      expect(ledger()).toContainEqual(
        expect.objectContaining({ subject: "ar/b_reject", reason: "loader rejected" }),
      );
    });

    it("names a loader that throws synchronously, without propagating", () => {
      const store = new I18nStore();
      store.locale = "ar";
      expect(() =>
        store.loadLazyBoundary("b_throw", (() => {
          throw new Error("boom");
        }) as never),
      ).not.toThrow();

      expect(ledger()).toContainEqual(
        expect.objectContaining({ subject: "ar/b_throw", reason: "loader threw synchronously" }),
      );
    });

    it("names a skipped load rather than returning silently", () => {
      const store = new I18nStore();
      store.locale = "ar";
      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } });
      void store.loadLazyBoundary("b1", (() => ({ b1: {} })) as never);

      expect(ledger()).toContainEqual(
        expect.objectContaining({
          subject: "ar/b1",
          outcome: "superseded",
          reason: "already loaded",
        }),
      );
    });

    it("reports a switch to the locale already active", async () => {
      // A correct no-op used to return without notifying, so anything waiting
      // on it waited until timeout — indistinguishable from a real stall.
      const store = new I18nStore();
      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } });
      store.locale = "ar";

      const before = beacon();
      await store.setLocale("ar");

      expect(beacon()).toBeGreaterThan(before);
      expect(ledger()).toContainEqual(
        expect.objectContaining({ channel: "runtime/locale", reason: "already active" }),
      );
    });
  });

  describe("Corollary D2a — an unchanged delivery is still a delivery", () => {
    it("advances the beacon but does not wake subscribers", () => {
      const store = new I18nStore();
      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } });

      let notified = 0;
      store.subscribe(() => notified++);
      const before = beacon();

      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } });

      // An observer learns the store finished with it …
      expect(beacon()).toBeGreaterThan(before);
      // … while subscribers, which have nothing to re-render, are left alone.
      expect(notified).toBe(0);
    });
  });

  describe("locale capture", () => {
    it("files a late catalog under the locale it was requested for", () => {
      // Reading `this.locale` again after the await stored one language's
      // strings under another's key whenever a switch landed mid-load.
      const store = new I18nStore();
      store.locale = "ar";

      let release!: (v: unknown) => void;
      const inFlight = store.loadLazyBoundary(
        "b1",
        (() => new Promise((r) => (release = r))) as never,
      );

      store.locale = "fr";
      release({ b1: { hi: "مرحبا" } });

      return Promise.resolve(inFlight).then(() => {
        expect(store.catalogs["ar"]?.["b1"]?.["hi"]).toBe("مرحبا");
        expect(store.catalogs["fr"]?.["b1"]).toBeUndefined();
      });
    });
  });

  describe("in-flight loads", () => {
    it("joins a concurrent request instead of dropping it", async () => {
      // The second caller used to be handed `undefined`: no promise to await,
      // nothing to supersede, and a caller that believed it had started a load.
      const store = new I18nStore();
      store.locale = "ar";

      let release!: (v: unknown) => void;
      const loader = (() => new Promise((r) => (release = r))) as never;

      const first = store.loadLazyBoundary("b1", loader);
      const second = store.loadLazyBoundary("b1", loader);

      expect(first).toBeInstanceOf(Promise);
      expect(second).toBe(first);

      release({ b1: { hi: "مرحبا" } });
      await first;
    });

    it("drops a settled load from pendingPromises", async () => {
      // The server drains this queue to gate stream injection; nothing drained
      // it in a browser, so a long-lived page retained every lazy load it made.
      const store = new I18nStore();
      store.locale = "ar";

      const p = store.loadLazyBoundary("b1", (() =>
        Promise.resolve({ b1: { hi: "مرحبا" } })) as never);
      expect(store.pendingPromises).toHaveLength(1);

      await p;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.pendingPromises).toHaveLength(0);
    });
  });

  describe("subscriber isolation", () => {
    it("runs every subscriber even when one throws", () => {
      // `forEach` over a raw set meant one throwing subscriber silently
      // cancelled every subscriber registered after it.
      const store = new I18nStore();
      const ran: string[] = [];
      store.subscribe(() => {
        ran.push("first");
        throw new Error("boom");
      });
      store.subscribe(() => ran.push("second"));

      store.addCatalogs({ ar: { b1: { hi: "مرحبا" } } });

      expect(ran).toEqual(["first", "second"]);
    });
  });

  describe("Axiom D5 — the ledger stays bounded", () => {
    it("retains a fixed number of entries however many deliveries occur", () => {
      const store = new I18nStore();
      for (let i = 0; i < 400; i++) {
        store.addCatalogs({ ar: { [`b${i}`]: { hi: String(i) } } });
      }
      // Bounded is normative: `memory-leak` measures retained heap across
      // twenty consecutive hot updates with only a few hundred KB of headroom.
      expect(ledger().length).toBeLessThanOrEqual(128);
      // The beacon is a counter, not a buffer — it keeps counting.
      expect(beacon()).toBeGreaterThanOrEqual(400);
    });
  });
});
