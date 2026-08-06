/**
 * Defaults, pinned.
 *
 * Every value here used to be applied lazily at a read site — `locales` in eight
 * places, `sourceLocale` in four, `logLevel` in three stacked layers. Nothing
 * asserted any of them, so a drifting default was invisible. These tests are the
 * record of what Zintl actually does when you configure nothing.
 */
import { describe, it, expect } from "vite-plus/test";
import { DEFAULTS, resolveOptions } from "../options.js";

describe("resolveOptions", () => {
  it("applies every context-free default", () => {
    const resolved = resolveOptions();

    expect(resolved.sourceLocale).toBe("en");
    expect(resolved.locales).toEqual(["en"]);
    expect(resolved.prune).toBe(true);
    expect(resolved.debug).toBe(false);
    expect(resolved.virtualAssets).toBe(false);
    expect(resolved.facets).toEqual(["builtins"]);
  });

  it("treats an absent options object the same as an empty one", () => {
    expect(resolveOptions()).toEqual(resolveOptions({}));
  });

  it("never overrides a user value", () => {
    const resolved = resolveOptions({
      sourceLocale: "ar",
      locales: ["ar", "fr"],
      prune: false,
      debug: "trace",
      virtualAssets: true,
      facets: [],
    });

    expect(resolved.sourceLocale).toBe("ar");
    expect(resolved.locales).toEqual(["ar", "fr"]);
    expect(resolved.prune).toBe(false);
    expect(resolved.debug).toBe("trace");
    expect(resolved.virtualAssets).toBe(true);
    expect(resolved.facets).toEqual([]);
  });

  it("preserves falsy user values rather than replacing them with defaults", () => {
    // `prune: false` and `debug: false` must survive — `??` not `||`.
    const resolved = resolveOptions({ prune: false, debug: false });
    expect(resolved.prune).toBe(false);
    expect(resolved.debug).toBe(false);
  });

  it("leaves the two Vite-dependent defaults unresolved", () => {
    // These cannot be known at plugin creation; configResolvedHook applies them.
    const resolved = resolveOptions();
    expect(resolved.multiplex).toBeUndefined();
    expect(resolved.verifyIntegrity).toBeUndefined();
    expect(resolved.logLevel).toBeUndefined();
  });

  it("leaves compiler-owned defaults unresolved so the compiler applies its own", () => {
    // Re-stating outputDir / catalogFormat / metadataDir / similarityThreshold
    // here would recreate the duplication this module exists to remove.
    const resolved = resolveOptions();
    expect(resolved.outputDir).toBeUndefined();
    expect(resolved.catalogFormat).toBeUndefined();
    expect(resolved.metadataDir).toBeUndefined();
    expect(resolved.similarityThreshold).toBeUndefined();
  });

  it("exposes the same values through the DEFAULTS table", () => {
    const resolved = resolveOptions();
    expect(resolved.sourceLocale).toBe(DEFAULTS.sourceLocale);
    expect(resolved.locales).toEqual(DEFAULTS.locales);
    expect(resolved.prune).toBe(DEFAULTS.prune);
    expect(resolved.virtualAssets).toBe(DEFAULTS.virtualAssets);
  });

  it("does not share mutable default instances between calls", () => {
    const a = resolveOptions();
    const b = resolveOptions();
    a.locales.push("ar");
    expect(b.locales).toEqual(["en"]);
  });
});
