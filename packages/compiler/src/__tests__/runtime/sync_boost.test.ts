import { describe, it, expect, vi } from "vite-plus/test";
import { t, loadI18nInstance } from "../../runtime/internal.js";
import { getLocale } from "../../runtime/store.js";

describe("Zintl Runtime: Synchronous Boost", () => {
  it("should populate store synchronously for non-promise loaders", () => {
    const syncLoader = (_locale: string): any => {
      if (_locale === "ar") return { main: { key1: "مرحبا" } };
      return {};
    };

    // This call is "async" but should execute its primary side-effects synchronously
    void loadI18nInstance({
      locale: "ar",
      loaders: { main: syncLoader },
      debug: false,
    });

    // ASSERT: Store updated immediately! No await required.
    expect(getLocale()).toBe("ar");
    expect(t("key1", { _bId: "main" })).toBe("مرحبا");
  });

  it("should handle mixed sync/async loaders gracefully", async () => {
    const syncLoader = (_locale: string) => ({ s1: { sync: "value" } });
    const asyncLoader = (_locale: string) => Promise.resolve({ a1: { async: "value" } });

    const promise = loadI18nInstance({
      locale: "ar",
      loaders: {
        s1: syncLoader,
        a1: asyncLoader,
      },
      debug: false,
    });

    // Sync part already done!
    expect(t("sync", { _bId: "s1" })).toBe("value");

    // Async part not yet done, so the key is a miss and renders as a marked
    // placeholder while serving rather than as an empty string.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("async", { _bId: "a1" })).toBe("⟦àšýñç⟧");
    spy.mockRestore();

    await promise;

    // Both done now!
    expect(t("sync", { _bId: "s1" })).toBe("value");
    expect(t("async", { _bId: "a1" })).toBe("value");
  });
});
