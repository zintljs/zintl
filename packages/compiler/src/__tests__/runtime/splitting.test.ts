import { describe, it, expect } from "vite-plus/test";
import { getRuntimeCode } from "../../index.js";
import type { CapabilityFlags } from "../../types/capabilities.js";

describe("Runtime Splitting - getRuntimeCode", () => {
  const baseCapabilities: CapabilityFlags = {
    jsx: false,
    sfc: false,
    jsxRichText: false,
    clientLocaleSync: false,
    serverRequestScope: false,
    streaming: false,
    entryReexecutionSafe: true,
    ssr: false,
    hmr: false,
    localeRouting: false,
    htmlFanOut: false,
    hotUpdate: false,
    dependencyInvalidation: false,
    sfcBlockRequestsCarryWholeFile: false,
  };

  it("should return base store code with only store-core exports when capabilities are disabled", () => {
    const code = getRuntimeCode("store", baseCapabilities);
    expect(code).toContain('export * from "./store-core.js";');
    expect(code).not.toContain('import "./store-client.js";');
    expect(code).not.toContain('import "./store-server.js";');
  });

  it("should compose store with store-client when clientLocaleSync is true", () => {
    const code = getRuntimeCode("store", {
      ...baseCapabilities,
      clientLocaleSync: true,
    });
    expect(code).toContain('export * from "./store-core.js";');
    expect(code).toContain('import "./store-client.js";');
    expect(code).not.toContain('import "./store-server.js";');
  });

  it("should compose store with store-server when serverRequestScope is true", () => {
    const code = getRuntimeCode("store", {
      ...baseCapabilities,
      serverRequestScope: true,
    });
    expect(code).toContain('export * from "./store-core.js";');
    expect(code).not.toContain('import "./store-client.js";');
    expect(code).toContain('import "./store-server.js";');
  });

  it("should compose store with both client and server when both capabilities are true", () => {
    const code = getRuntimeCode("store", {
      ...baseCapabilities,
      clientLocaleSync: true,
      serverRequestScope: true,
    });
    expect(code).toContain('export * from "./store-core.js";');
    expect(code).toContain('import "./store-client.js";');
    expect(code).toContain('import "./store-server.js";');
  });

  it("should omit store-server when serverRequestScope is true but isSsr is false (client build)", () => {
    const code = getRuntimeCode(
      "store",
      {
        ...baseCapabilities,
        serverRequestScope: true,
      },
      false,
    );
    expect(code).toContain('export * from "./store-core.js";');
    expect(code).not.toContain('import "./store-client.js";');
    expect(code).not.toContain('import "./store-server.js";');
  });

  it("should load full file contents for other runtime modules", () => {
    const registryCode = getRuntimeCode("registry");
    expect(registryCode).toContain("export function registerZintlLoader");

    const resolverCode = getRuntimeCode("resolver");
    expect(resolverCode).toContain("export function _t");
  });

  it("should throw error for non-existent runtime modules", () => {
    expect(() => getRuntimeCode("invalid-module-name" as any)).toThrow(/Runtime module not found/);
  });

  /**
   * The direction map reaches the browser as a substituted literal, and a
   * substitution that silently matches nothing is the dangerous failure: the
   * runtime still loads, and simply believes the project has no RTL locale.
   * These assert the sentinel is gone afterwards, not merely that the value
   * appeared somewhere.
   */
  describe("RTL locale substitution", () => {
    it("folds the direction map into a literal array", () => {
      const code = getRuntimeCode("store-core", baseCapabilities, false, false, ["ar", "he"]);
      expect(code).toContain('["ar","he"]');
      expect(code).not.toContain("__ZINTL_RTL_LOCALES__");
    });

    it("folds to an empty array when no locale is right-to-left", () => {
      const code = getRuntimeCode("store-core", baseCapabilities, false, false, []);
      expect(code).toContain("[]");
      expect(code).not.toContain("__ZINTL_RTL_LOCALES__");
    });

    it("still substitutes when the caller omits the argument", () => {
      // The default matters: an unsubstituted sentinel is a ReferenceError in
      // the browser, so "the caller forgot" must not be a way to reach one.
      const code = getRuntimeCode("store-core", baseCapabilities);
      expect(code).not.toContain("__ZINTL_RTL_LOCALES__");
    });
  });
});
