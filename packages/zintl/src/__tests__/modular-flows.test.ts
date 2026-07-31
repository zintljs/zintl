import { describe, it, expect } from "vite-plus/test";
import { createZintlContext } from "./helpers/harness.ts";

/**
 * High-Fidelity Integration Suite: Modular SPA Flows
 *
 * Verifies that the compiler correctly handles static vs dynamic boundaries
 * and injects the registry-based managers.
 */

describe("Flow: Modular SPA", () => {
  // it("should consolidate static dependencies into a single entry manager", async () => {
  //   // 1. Force Dev Mode so we see the manager handover/injection
  //   const devCtx = await createZintlContext({ isDev: true });

  //   const files = {
  //     "src/main.ts": `import { zintl } from "zintljs"; zintl("en"); import "./ui";`,
  //     "src/ui.ts": `document.body.innerHTML = "Welcome";`,
  //   };

  //   const results = await devCtx.project(files);
  //   const { matchers } = devCtx;

  //   // Consolidation: ui.ts has no anchor, so it joins main.ts's boundary
  //   // matchers.toRegisterManager(results["src/ui.ts"], "src/ui", { locale: "en" });

  //   // matchers.toNotImportFromZintl(results["src/ui.ts"], ["loadI18nInstance"]);
  //   await devCtx.cleanup();
  // });

  it("should consolidate shared boundaries between parallel entries", async () => {
    //TODO: Reenable matchers after fixing the baking.
    const ctx = await createZintlContext({ logLevel: "silent" });
    const files = {
      "src/main.ts": `import { zintl } from "zintljs"; zintl(window.navigator.language || "en"); import "./shared";`,
      "src/other.ts": `import { zintl } from "zintljs"; zintl(window.navigator.language || "en"); import "./shared";`,
      "src/shared.ts": `import "zintljs"; document.body.innerHTML = "Welcome";`,
    };

    const results = await ctx.project(files);
    // const { matchers } = ctx;

    // Shared boundary used by two entries.
    // In our system, src/shared is its own root because of the import marker.
    // const sharedBId = "b_e30d15249a44";
    // matchers.toRegisterManager(results["src/shared.ts"], sharedBId, { locale: "none" });

    expect(results).toMatchSnapshot();
  });

  it("should isolate dynamic dependencies into independent lazy chunks", async () => {
    // 1. Set to Dev Mode to ensure we see t() calls instead of baking
    const devCtx = await createZintlContext({ isDev: true, logLevel: "silent" });

    const files = {
      "src/main.ts": `import { zintl } from "zintljs"; zintl("en"); const load = () => import("./lazy");`,
      "src/lazy.ts": `import "zintljs"; document.body.innerHTML = "Sub Page";`,
    };

    const results = await devCtx.project(files);
    const { matchers } = devCtx;

    // The lazy boundary should be its own root and use t() in dev mode
    matchers.toRegisterManager(results["src/lazy.ts"], "src/lazy", { locale: "none" });
    matchers.toRegisterT(results["src/lazy.ts"], "Sub Page", "src/lazy", { context: "innerHTML" });

    // matchers.toImportFromZintl(results["src/lazy.ts"], ["t", "loadI18nInstance"]);

    expect(results).toMatchSnapshot();
    await devCtx.cleanup();
  });

  // it("should suppress injection for empty ghost boundaries (Baseline of Shame)", async () => {
  //   const files = {
  //     "src/ghost.ts": `import "zintljs"; console.log("I am empty");`,
  //   };

  //   const results = await ctx.project(files);
  //   const ghostCode = results["src/ghost.ts"];

  //   // In the new system, even empty boundaries with a marker get a manager (Kingdom status preserved)
  //   expect(ghostCode).toContain("import _zintl_mgr_b_e2cc5ed95eaf");

  //   expect(results).toMatchSnapshot();
  // });
});
