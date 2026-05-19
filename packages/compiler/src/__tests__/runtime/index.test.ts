import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { t, loadI18nInstance, zintl, subscribe, addCatalogs } from "../../runtime/internal.js";
import { getLocale } from "../../runtime/store.js";

describe("Zintl Runtime", () => {
  beforeEach(async () => {
    await loadI18nInstance({
      locale: "en",
      catalogs: {
        en: {
          hero: {
            title: "Welcome {name}",
            tagline: "The fastest i18n",
          },
        },
      },
      debug: false,
    });
  });

  it("translates a message with interpolation", () => {
    expect(t("title", { name: "World", _bId: "hero" })).toBe("Welcome World");
  });

  it("returns empty string if translation missing", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("missing")).toBe("");
    spy.mockRestore();
  });

  it("should handle function-based translations for complex logic", async () => {
    const catalogs = {
      en: {
        main: {
          plural: (params: any) => (params.count === 1 ? "One item" : `${params.count} items`),
        },
      },
    };
    await loadI18nInstance({ catalogs, locale: "en" });

    expect(t("plural", { count: 1, _bId: "main" })).toBe("One item");
    expect(t("plural", { count: 5, _bId: "main" })).toBe("5 items");
  });

  it("should return empty string if message is not a string/function", async () => {
    const catalogs = {
      en: {
        main: {
          bad: null as any,
        },
      },
    };
    await loadI18nInstance({ catalogs, locale: "en" });

    expect(t("bad", { _bId: "main" })).toBe("");
  });

  it("manages locale state", async () => {
    expect(getLocale()).toBe("en");
    await zintl("ar");
    expect(getLocale()).toBe("ar");

    // Neutral on Null
    await zintl(null as any);
    expect(getLocale()).toBe("ar");
    await zintl(undefined as any);
    expect(getLocale()).toBe("ar");
  });

  it("supports reactive updates via subscribe", async () => {
    let count = 0;
    const unsub = subscribe(() => count++);
    await zintl("fr");
    expect(count).toBe(1);
    unsub();
  });

  it("merges catalogs incrementally", () => {
    addCatalogs({
      en: {
        footer: {
          copyright: "© 2026",
        },
      },
    });
    expect(t("tagline", { _bId: "hero" })).toBe("The fastest i18n");
    expect(t("copyright", { _bId: "footer" })).toBe("© 2026");
  });
});
