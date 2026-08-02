import { describe, it, expect, vi } from "vite-plus/test";
import { _t } from "../../runtime/resolver.js";
import { setActiveInstance, I18nStore } from "../../runtime/store.js";

// this test shoule mock `console.warn` since we do not want those prints to the console in testing!
describe("Resolver", () => {
  it("should handle missing keys by returning an empty string", () => {
    const store = new I18nStore();
    setActiveInstance(store);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(_t("non_existent")).toBe("");
  });

  it("should warn in debug mode for missing keys", () => {
    const store = new I18nStore();
    store.debug = false;
    setActiveInstance(store);

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    _t("missing");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should support functional translations", () => {
    const store = new I18nStore();
    store.addCatalogs({
      en: {
        b1: {
          greet: (p: any) => `Hello ${p.name}`,
        },
      },
    });
    store.locale = "en";
    setActiveInstance(store);

    expect(_t("greet", { name: "Zintl", _bId: "b1" })).toBe("Hello Zintl");
  });

  it("should trigger manager registration for missing keys if mgr is provided", async () => {
    const store = new I18nStore();
    setActiveInstance(store);

    let resolveLoader: any;
    const loader = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLoader = resolve;
        }),
    );
    const mgr = { id: "new_b", loader };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = _t("any", {}, { _mgr: mgr });
    expect(result).toBe("");

    // `_t` triggers the load inline now, so the boundary is already pending.
    expect(store.pendingBoundaries.has("new_b")).toBe(true);

    /**
     * Resolving the loader settles the load through `then → catch → finally`,
     * so counting microtask ticks is a bet on the chain's depth — it broke the
     * moment a `.catch` was added. A macrotask boundary drains all of them
     * regardless of how the chain is built.
     */
    resolveLoader({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.pendingBoundaries.has("new_b")).toBe(false);
  });
});
