import { describe, it, expect, vi } from "vite-plus/test";
import { _t } from "../../runtime/resolver.js";
import { setActiveInstance, I18nStore } from "../../runtime/store.js";

// this test shoule mock `console.warn` since we do not want those prints to the console in testing!
describe("Resolver", () => {
  /**
   * An untranslated string renders as visibly-pseudo-localized text while
   * serving, rather than as nothing. `__ZINTL_PSEUDO__` is defined true for
   * unit tests because that is the environment they stand in; a production
   * build folds the branch away and the miss returns `""` again. That folding
   * is asserted in `splitting.test.ts`, against `getRuntimeCode`'s output,
   * which is where it actually happens.
   */
  it("marks a missing key as untranslated instead of rendering nothing", () => {
    const store = new I18nStore();
    setActiveInstance(store);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = _t("non_existent");
    expect(result).toBe("⟦ñöñ_éẋíšţéñţ⟧");
    // Unmistakable on purpose: a dev placeholder that could pass for a
    // translation would be a source-locale fallback wearing a costume.
    expect(result).not.toContain("non_existent");
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

  /**
   * The placeholder-preservation rule, which is the part with teeth.
   *
   * `{count}` is read back by `interpolate` and `<t0>` by the tag restoration
   * that follows it, so accenting either would turn a visible placeholder into
   * a broken one — an interpolation that never lands, or markup rendered as
   * text. Pseudo text also goes through both of those passes rather than being
   * returned early, so the page keeps its shape and only the words change.
   */
  describe("pseudo-localized misses", () => {
    const missWith = (key: string, params: Record<string, any> = {}) => {
      const store = new I18nStore();
      setActiveInstance(store);
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        return _t(key, params);
      } finally {
        spy.mockRestore();
      }
    };

    it("leaves ICU placeholders alone and still interpolates them", () => {
      expect(missWith("You have {count} new messages", { count: 3 })).toBe(
        "⟦Ýöü ĥàṽé 3 ñéẁ ṁéššàĝéš⟧",
      );
    });

    it("leaves an uninterpolated placeholder legible rather than accented", () => {
      expect(missWith("Total: {amount}")).toBe("⟦Ţöţàļ: {amount}⟧");
    });

    it("leaves markup tags intact", () => {
      expect(missWith("Sign in with <t0>your account</t0>")).toBe(
        "⟦Šíĝñ íñ ẁíţĥ <t0>ýöüŕ àççöüñţ</t0>⟧",
      );
    });

    it("passes non-Latin text through untouched", () => {
      expect(missWith("مرحبا mixed")).toBe("⟦مرحبا ṁíẋéð⟧");
    });

    it("preserves punctuation, digits and whitespace", () => {
      expect(missWith("  2 items — 50% off!  ")).toBe("⟦  2 íţéṁš — 50% öƒƒ!  ⟧");
    });
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
    // Pseudo-localized rather than empty while serving — see the note above.
    expect(result).toBe("⟦àñý⟧");

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
