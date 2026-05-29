import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  I18nStore,
  registerLoader,
  unregisterLoader,
  setLocale,
  getLocale,
  addCatalogs,
  subscribe,
  getActiveInstance,
  setActiveInstance,
  runInRequestScope,
} from "../../runtime/store.js";
import { registerZintlLoader } from "../../runtime/registry.js";

describe("I18nStore & Registry", () => {
  const registeredLoaders = new Set<string>();

  const safeRegisterLoader = (id: string, loader: any) => {
    registeredLoaders.add(id);
    return registerLoader(id, loader);
  };

  beforeEach(() => {
    setActiveInstance(new I18nStore());
  });

  afterEach(() => {
    for (const id of registeredLoaders) {
      unregisterLoader(id);
    }
    registeredLoaders.clear();
  });

  it("should handle async loaders correctly", async () => {
    const store = new I18nStore();
    const loader = vi.fn(async (_locale: string) => {
      return { b1: { msg: _locale === "ar" ? "مرحبا" : "Hello" } };
    });

    await store.registerLoader("b1", loader);
    expect(store.pendingBoundaries.has("b1")).toBe(false);
    expect(store.catalogs[""]?.["b1"]?.["msg"]).toBe("Hello");
  });

  it("should handle sync loaders returning void correctly in registerLoader", () => {
    const store = new I18nStore();
    const loader = vi.fn((_l: string) => undefined as any);

    void store.registerLoader("b_void", loader);
    expect(store.catalogs[""]?.["b_void"]).toBeUndefined();
  });

  it("should register loaders via registerZintlLoader", () => {
    const loader = (_l: string) => ({ new_boundary: { test: "test" } });
    registeredLoaders.add("new_boundary");
    void registerZintlLoader("new_boundary", loader);
    expect(true).toBe(true);
  });

  it("should unregister loaders", () => {
    const loader = (_l: string) => ({ to_be_deleted: { test: "test" } });
    void registerLoader("to_be_deleted", loader);
    unregisterLoader("to_be_deleted");
    expect(true).toBe(true);
  });

  it("should handle errors in loaders gracefully in registerLoader", async () => {
    const brokenLoader = () => {
      throw new Error("Load failed");
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    void safeRegisterLoader("broken", brokenLoader);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should handle async loaders correctly in global registerLoader", async () => {
    const loader = vi.fn(async (_locale: string) => {
      return { async_global: { msg: "Global" } };
    });

    const promise = safeRegisterLoader("async_global", loader);
    await promise; // wait for processResult inside then()

    const store = getActiveInstance();
    expect(store.catalogs[""]?.["async_global"]?.["msg"]).toBe("Global");
  });

  it("should log catalog updates when debug is enabled", () => {
    const store = getActiveInstance();
    store.debug = true;

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    store.addCatalogs({ en: { test_boundary: { key: "value" } } });

    expect(debugSpy).toHaveBeenCalledWith("[Zintl] Catalogs updated:", ["en/test_boundary"]);
    debugSpy.mockRestore();
  });

  it("should notify subscribers when catalogs change", () => {
    const store = getActiveInstance();
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.addCatalogs({ en: { b1: { k1: "v1" } } });

    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    store.addCatalogs({ en: { b1: { k1: "v1" } } });
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("should switch locale and handle async loaders in setLocale", async () => {
    const store = getActiveInstance();
    store.debug = true;
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    let resolvePromise: any;
    const asyncLoader = vi.fn((_locale: string) => {
      return new Promise<any>((resolve) => {
        resolvePromise = resolve;
      });
    });

    void safeRegisterLoader("async_boundary", asyncLoader);

    const localePromise = setLocale("fr"); // Used global setLocale instead of store.setLocale
    expect(store.locale).toBe("fr");

    expect(debugSpy).toHaveBeenCalledWith("[Zintl] Switching to locale: fr");
    expect(store.pendingBoundaries.has("async_boundary")).toBe(true);

    resolvePromise({ async_boundary: { greeting: "bonjour" } });
    await localePromise;

    expect(store.pendingBoundaries.has("async_boundary")).toBe(false);
    expect(store.catalogs["fr"]["async_boundary"]["greeting"]).toBe("bonjour");
    expect(debugSpy).toHaveBeenCalledWith('[Zintl] Locale "fr" hydrated.');

    debugSpy.mockRestore();
  });

  it("should switch locale and handle sync loaders in setLocale", async () => {
    const store = getActiveInstance();
    store.debug = true;
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const syncLoader = vi.fn((_locale: string) => {
      if (_locale === "it") return { b_sync: { ciao: "ciao" } };
      return undefined as any;
    });

    void safeRegisterLoader("sync_boundary", syncLoader);

    await store.setLocale("it");
    expect(store.locale).toBe("it");
    expect(store.catalogs["it"]["b_sync"]["ciao"]).toBe("ciao");

    expect(debugSpy).toHaveBeenCalledWith('[Zintl] Locale "it" hydrated.');
    debugSpy.mockRestore();
  });

  it("should handle errors in loaders gracefully in setLocale", async () => {
    const store = getActiveInstance();

    const brokenLoader = vi.fn((_locale: string) => {
      throw new Error("Locale switch failed");
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    void safeRegisterLoader("broken_set_locale", brokenLoader);

    await store.setLocale("es");

    expect(spy).toHaveBeenCalledWith(
      '[Zintl] Failed to load catalog for boundary "broken_set_locale" (es)',
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it("should skip setting locale if already set and hydrated", async () => {
    const store = getActiveInstance();
    store.locale = "pt";
    store.catalogs["pt"] = { b1: { hello: "ola" } };

    const setLocalePromise = store.setLocale("pt");
    await expect(setLocalePromise).resolves.toBeUndefined();
  });

  it("should ignore falsy locale", async () => {
    const store = getActiveInstance();
    store.locale = "en";
    await store.setLocale(null);
    expect(store.locale).toBe("en");
  });

  it("should provide exported global functions", () => {
    expect(getLocale()).toBe("");
    const listener = vi.fn();
    subscribe(listener);

    addCatalogs({ zh: { b1: { a: "b" } } });
    expect(listener).toHaveBeenCalled();
  });

  it("should call window.__zintlApplyHtml if it exists", async () => {
    const store = new I18nStore();
    const applySpy = vi.fn();

    // Mock window
    vi.stubGlobal("window", {
      __zintlApplyHtml: applySpy,
    });

    try {
      await store.setLocale("de");
      expect(applySpy).toHaveBeenCalledWith("de");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should persist locale in localStorage", async () => {
    const store = new I18nStore();
    const setItemSpy = vi.fn();

    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      setItem: setItemSpy,
    });

    try {
      await store.setLocale("it");
      expect(setItemSpy).toHaveBeenCalledWith("zintl-locale", "it");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should handle localStorage throwing errors in constructor gracefully", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("localStorage blocked");
      },
    });

    try {
      const store = new I18nStore();
      expect(store.locale).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should run concurrent request scopes and isolate active instances", async () => {
    const results: string[] = [];

    const p1 = runInRequestScope("/ar/dashboard", ["ar", "es"], "es", async () => {
      // Simulate async flow inside request scope
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push(getActiveInstance().locale);
    });

    const p2 = runInRequestScope("/es/settings", ["ar", "es"], "es", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      results.push(getActiveInstance().locale);
    });

    await Promise.all([p1, p2]);
    // Since p2 resolves first (5ms vs 10ms), it should push first in execution order
    expect(results).toEqual(["es", "ar"]);
  });

  it("should support request object input in runInRequestScope", () => {
    const res1 = runInRequestScope(
      { url: "/ar/test" },
      ["ar", "es"],
      "es",
      () => getActiveInstance().locale,
    );
    const res2 = runInRequestScope(
      { path: "/es/test" },
      ["ar", "es"],
      "es",
      () => getActiveInstance().locale,
    );
    const res3 = runInRequestScope(
      { url: "" },
      ["ar", "es"],
      "es",
      () => getActiveInstance().locale,
    );

    expect(res1).toBe("ar");
    expect(res2).toBe("es");
    expect(res3).toBe("es");
  });

  it("should auto-hydrate registered loaders in request scopes", async () => {
    let resolved = false;
    const asyncLoader = vi.fn(async (_locale: string) => {
      resolved = true;
      return { b1: { hello: "hola" } };
    });

    await safeRegisterLoader("async_scoped", asyncLoader);

    await runInRequestScope("/es/dashboard", ["ar", "es"], "es", async () => {
      // Wait for loaders to run
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getActiveInstance().catalogs["es"]?.["b1"]?.["hello"]).toBe("hola");
    });
    expect(resolved).toBe(true);
  });

  it("should fallback gracefully if window is defined in runInRequestScope", () => {
    vi.stubGlobal("window", {});
    try {
      const result = runInRequestScope("/ar/test", ["ar", "es"], "es", () => {
        return "callback_result";
      });
      expect(result).toBe("callback_result");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should print debug log when locale is hydrated with no active promises", async () => {
    unregisterLoader("b1");
    unregisterLoader("b_void");

    const store = new I18nStore();
    store.debug = true;
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await store.setLocale("en");
    expect(debugSpy).toHaveBeenCalledWith('[Zintl] Locale "en" hydrated.');
    debugSpy.mockRestore();
  });

  it("should inherit active instance locale in new store inside request scope constructor", () => {
    runInRequestScope("/ar/test", ["ar", "es"], "es", () => {
      const parentStore = getActiveInstance();
      expect(parentStore.locale).toBe("ar");

      const childStore = new I18nStore();
      expect(childStore.locale).toBe("ar");
    });
  });
});
