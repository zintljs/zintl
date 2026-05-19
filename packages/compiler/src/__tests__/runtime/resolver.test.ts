import { describe, it, expect, vi } from "vitest";
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

  it("should trigger manager registration for missing keys if mgr is provided", () => {
    const store = new I18nStore();
    setActiveInstance(store);

    const loader = vi.fn(async () => ({}));
    const mgr = { id: "new_b", loader };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = _t("any", {}, { _mgr: mgr });
    expect(result).toBe("");
    expect(store.pendingBoundaries.has("new_b")).toBe(true);
  });
});
