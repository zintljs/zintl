import { describe, it, expect, vi } from "vitest";
import { loadI18nInstance } from "../internal.js";
import { I18nStore, getActiveInstance, setActiveInstance } from "../store.js";

describe("loadI18nInstance", () => {
  it("should create a configured i18n instance", async () => {
    const instance = await loadI18nInstance({
      locale: "en",
      debug: false,
      catalogs: {
        en: {
          b1: { hello: "Hello World" },
        },
      },
    });

    expect(instance.locale).toBe("en");
    expect(instance.debug).toBe(false);
    expect(instance.t("hello", { _bId: "b1" })).toBe("Hello World");
  });

  it("should allow debugging to be toggled", async () => {
    const instance = await loadI18nInstance();
    instance.debug = true;
    expect(instance.debug).toBe(true);
    instance.debug = false;
    expect(instance.debug).toBe(false);
  });

  it("should support subscriptions", async () => {
    const instance = await loadI18nInstance();
    const spy = vi.fn();
    instance.subscribe(spy);

    // Trigger update
    await instance.setLocale("ar");
    expect(spy).toHaveBeenCalled();
  });

  it("should set the new instance as active", async () => {
    const mainStore = new I18nStore();
    setActiveInstance(mainStore);

    const instance = await loadI18nInstance({
      locale: "en",
      catalogs: { en: { b1: { msg: "Isolated" } } },
    });

    // It should now be the active instance
    expect(getActiveInstance()).not.toBe(mainStore);

    const result = instance.t("msg", { _bId: "b1" });
    expect(result).toBe("Isolated");
  });
});
