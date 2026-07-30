/**
 * Pure compiler-internal units, split out of the old `sfc_integration.test.ts`.
 *
 * The SFC compilation half of that file needed a resolved Vue/Svelte world and
 * therefore moved to the plugin package. These two blocks touch no facets and
 * construct no compiler, so they stay here with the code they exercise.
 */
import { describe, it, expect } from "vite-plus/test";
import { bakeICU } from "../utils/icu-baker.js";
import { runInRequestScope, I18nStore, getActiveInstance } from "../runtime/store.js";

describe("ICU Baker Failures", () => {
  it("should fallback gracefully on malformed ICU strings", () => {
    const result = bakeICU("Hello {name", "en");
    expect(result).toBeNull();
  });
});

describe("Runtime I18nStore fallbacks & request context", () => {
  it("should load store with document fallback, window state", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    try {
      (globalThis as any).document = {
        documentElement: {
          lang: "es",
        },
      };
      (globalThis as any).window = {};

      // Test constructor fallback lang
      const store = new I18nStore();
      expect(store.locale).toBe("es");
    } finally {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
    }
  });

  it("should run request scopes in node environments", () => {
    const result = runInRequestScope("/ar/test-route", ["ar", "es"], "es", () => {
      const active = getActiveInstance();
      return active.locale;
    });
    expect(result).toBe("ar");
  });
});
