import { describe, it, expect } from "vite-plus/test";
import { resolveAdapters, registerPreset } from "../../adapter/index.js";
import type { ZintlAdapter } from "../../adapter/index.js";

describe("Adapter Resolution Engine", () => {
  // ── Preset Expansion ────────────────────────────────────────────────────────

  describe("preset expansion", () => {
    it("expands 'react' preset to extraction + codegen adapters", () => {
      const { adapters } = resolveAdapters(["react"]);
      expect(adapters.some((a) => a.name === "react-extraction")).toBe(true);
      expect(adapters.some((a) => a.name === "react-codegen")).toBe(true);
    });

    it("expands 'vue' preset to extraction + codegen adapters", () => {
      const { adapters } = resolveAdapters(["vue"]);
      expect(adapters.some((a) => a.name === "vue-extraction")).toBe(true);
      expect(adapters.some((a) => a.name === "vue-codegen")).toBe(true);
    });

    it("expands 'svelte' preset to extraction + codegen adapters", () => {
      const { adapters } = resolveAdapters(["svelte"]);
      expect(adapters.some((a) => a.name === "svelte-extraction")).toBe(true);
      expect(adapters.some((a) => a.name === "svelte-codegen")).toBe(true);
    });

    it("expands 'nextjs' preset to react + nextjs-ssr adapters", () => {
      const { adapters } = resolveAdapters(["nextjs"]);
      expect(adapters.some((a) => a.name === "react-extraction")).toBe(true);
      expect(adapters.some((a) => a.name === "react-codegen")).toBe(true);
      expect(adapters.some((a) => a.name === "nextjs-ssr")).toBe(true);
    });

    it("throws on unknown preset name", () => {
      expect(() => resolveAdapters(["unknown-framework-xyz"])).toThrow(
        /Unknown adapter preset "unknown-framework-xyz"/,
      );
    });

    it("throws with a list of known presets in the error", () => {
      expect(() => resolveAdapters(["unknown"])).toThrow(/Known presets:/);
    });
  });

  // ── Capability Resolution ───────────────────────────────────────────────────

  describe("ResolvedCapabilities", () => {
    it("vanilla adapter has no jsx/sfc/ssr/hmr capabilities", () => {
      const { capabilities } = resolveAdapters(["vanilla"]);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.sfc).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
      expect(capabilities.ssr).toBe(false);
      expect(capabilities.hmr).toBe(false);
    });

    it("react adapter enables jsx capability", () => {
      const { capabilities } = resolveAdapters(["react"]);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.jsxRichText).toBe(true);
      expect(capabilities.sfc).toBe(false);
    });

    it("vue adapter enables sfc capability", () => {
      const { capabilities } = resolveAdapters(["vue"]);
      expect(capabilities.sfc).toBe(true);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
    });

    it("svelte adapter enables sfc capability", () => {
      const { capabilities } = resolveAdapters(["svelte"]);
      expect(capabilities.sfc).toBe(true);
    });

    it("ssr adapter enables serverRequestScope and streaming", () => {
      const { capabilities } = resolveAdapters(["ssr"]);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.ssr).toBe(true);
    });

    it("client-spa adapter enables clientLocaleSync", () => {
      const { capabilities } = resolveAdapters(["client-spa"]);
      expect(capabilities.clientLocaleSync).toBe(true);
      expect(capabilities.localeRouting).toBe(true);
    });

    it("vite adapter enables hmr capability", () => {
      const { capabilities } = resolveAdapters(["vite"]);
      expect(capabilities.hmr).toBe(true);
    });

    it("nextjs adapter enables ssr + jsx + serverRequestScope + streaming", () => {
      const { capabilities } = resolveAdapters(["nextjs"]);
      expect(capabilities.ssr).toBe(true);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
    });

    it("empty adapters produces all-false capabilities", () => {
      const { capabilities } = resolveAdapters([]);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.sfc).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
      expect(capabilities.clientLocaleSync).toBe(false);
      expect(capabilities.serverRequestScope).toBe(false);
      expect(capabilities.streaming).toBe(false);
      expect(capabilities.ssr).toBe(false);
      expect(capabilities.hmr).toBe(false);
      expect(capabilities.localeRouting).toBe(false);
    });

    it("ssr boolean is OR-merged across multiple adapters", () => {
      // react doesn't enable ssr, ssr does — should be OR
      const { capabilities } = resolveAdapters(["react", "ssr"]);
      expect(capabilities.ssr).toBe(true);
      expect(capabilities.jsx).toBe(true);
    });
  });

  // ── Deterministic Merge — No Ordering Dependence ────────────────────────────

  describe("deterministic merge", () => {
    it("resolveVirtualPath hook is ordering-independent", () => {
      const myBundler: ZintlAdapter = {
        name: "my-bundler",
        bundler: { resolveVirtualPath: (id) => `\0${id}` },
      };
      // Order 1: myBundler first
      const r1 = resolveAdapters([myBundler]);
      // Order 2: vanilla first then myBundler
      const r2 = resolveAdapters(["vanilla", myBundler]);
      expect(r1.hooks.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
      expect(r2.hooks.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
    });

    it("runtime booleans are OR-merged across adapters regardless of order", () => {
      const { capabilities: c1 } = resolveAdapters(["ssr", "client-spa"]);
      const { capabilities: c2 } = resolveAdapters(["client-spa", "ssr"]);
      expect(c1.serverRequestScope).toBe(true);
      expect(c1.clientLocaleSync).toBe(true);
      expect(c2.serverRequestScope).toBe(true);
      expect(c2.clientLocaleSync).toBe(true);
    });

    it("extraction targets are unioned across adapters", () => {
      const { hooks } = resolveAdapters(["vanilla", "html"]);
      expect(hooks.extractionTargets).toContain("dom:prop:innerHTML");
      expect(hooks.extractionTargets).toContain("html:attr:alt");
    });

    it("extensions are unioned across adapters", () => {
      const { hooks } = resolveAdapters(["vue", "react"]);
      expect(hooks.extensions).toContain(".vue");
      expect(hooks.extensions).toContain(".tsx");
      expect(hooks.extensions).toContain(".jsx");
    });
  });

  // ── Conflict Detection ──────────────────────────────────────────────────────

  describe("conflict detection", () => {
    it("throws when two adapters claim the same extension for codegen", () => {
      const adapterA: ZintlAdapter = {
        name: "adapter-a",
        codegen: {
          extensions: [".custom"],
          match: (f) => f.endsWith(".custom"),
        },
      };
      const adapterB: ZintlAdapter = {
        name: "adapter-b",
        codegen: {
          extensions: [".custom"],
          match: (f) => f.endsWith(".custom"),
        },
      };
      expect(() => resolveAdapters([adapterA, adapterB])).toThrow(/Adapter conflict/);
      expect(() => resolveAdapters([adapterA, adapterB])).toThrow(/adapter-b/);
    });

    it("throws when two adapters both provide bundler.dynamicImportTemplate", () => {
      const bundlerA: ZintlAdapter = {
        name: "bundler-a",
        bundler: { dynamicImportTemplate: (p) => `import("${p}")` },
      };
      const bundlerB: ZintlAdapter = {
        name: "bundler-b",
        bundler: { dynamicImportTemplate: (p) => `require("${p}")` },
      };
      expect(() => resolveAdapters([bundlerA, bundlerB])).toThrow(/Adapter conflict/);
      expect(() => resolveAdapters([bundlerA, bundlerB])).toThrow(/bundler-b/);
    });

    it("throws when two adapters both provide ssr.wrapCode", () => {
      const ssrA: ZintlAdapter = {
        name: "ssr-a",
        ssr: { wrapCode: () => "wrapped" },
      };
      const ssrB: ZintlAdapter = {
        name: "ssr-b",
        ssr: { wrapCode: () => "also wrapped" },
      };
      expect(() => resolveAdapters([ssrA, ssrB])).toThrow(/Adapter conflict/);
    });

    it("throws when two adapters both provide bundler.resolveVirtualPath", () => {
      const bundlerA: ZintlAdapter = {
        name: "bundler-a",
        bundler: { resolveVirtualPath: (id) => `\0${id}` },
      };
      const bundlerB: ZintlAdapter = {
        name: "bundler-b",
        bundler: { resolveVirtualPath: (id) => id + "?resolved" },
      };
      expect(() => resolveAdapters([bundlerA, bundlerB])).toThrow(/Adapter conflict/);
    });
  });

  // ── Merged Hooks ────────────────────────────────────────────────────────────

  describe("MergedAdapterHooks", () => {
    it("resolveVirtualPath has a default passthrough when no bundler adapter", () => {
      const { hooks } = resolveAdapters(["vanilla"]);
      expect(hooks.resolveVirtualPath("virtual:zintl/content")).toBe("virtual:zintl/content");
    });

    it("dynamicImportTemplate has a default when no bundler adapter", () => {
      const { hooks } = resolveAdapters(["vanilla"]);
      expect(hooks.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("vite adapter provides @vite-ignore comment in dev mode", () => {
      const { hooks } = resolveAdapters(["vite"]);
      expect(hooks.dynamicImportTemplate("./foo", true)).toBe(`import(/* @vite-ignore */ "./foo")`);
      expect(hooks.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("codegenAdapters has correct adapters for vue+react combo", () => {
      const { hooks } = resolveAdapters(["vue", "react"]);
      const vueAdapter = hooks.codegenAdapters.find((a) => a.extensions.includes(".vue"));
      const reactAdapter = hooks.codegenAdapters.find((a) => a.extensions.includes(".tsx"));
      expect(vueAdapter).toBeDefined();
      expect(reactAdapter).toBeDefined();
    });

    it("vue codegen match works correctly", () => {
      const { hooks } = resolveAdapters(["vue", "react"]);
      const matched = hooks.codegenAdapters.find((a) => a.match("src/App.vue"));
      expect(matched?.extensions).toContain(".vue");
    });

    it("react codegen match works correctly", () => {
      const { hooks } = resolveAdapters(["vue", "react"]);
      const matched = hooks.codegenAdapters.find((a) => a.match("src/Button.tsx"));
      expect(matched?.extensions).toContain(".tsx");
    });

    it("ssrEntryTargets are unioned across adapters", () => {
      const customSsr: ZintlAdapter = {
        name: "custom-ssr",
        ssr: { entryTargets: ["my-custom-entry"] },
      };
      const { hooks } = resolveAdapters(["nextjs", customSsr]);
      expect(hooks.ssrEntryTargets).toContain("virtual:vinext-rsc-entry");
      expect(hooks.ssrEntryTargets).toContain("my-custom-entry");
    });

    it("detectLocale is chained — first non-undefined result wins", () => {
      const adapterA: ZintlAdapter = {
        name: "detect-a",
        runtime: {
          detectLocale: ({ url }) => (url?.includes("/ar/") ? "ar" : undefined),
        },
      };
      const adapterB: ZintlAdapter = {
        name: "detect-b",
        runtime: {
          detectLocale: ({ url }) => (url?.includes("/en/") ? "en" : undefined),
        },
      };
      const { hooks } = resolveAdapters([adapterA, adapterB]);
      const ctx = { locales: ["en", "ar"], defaultLocale: "en" };
      expect(hooks.detectLocale?.({ ...ctx, url: "/ar/home" })).toBe("ar");
      expect(hooks.detectLocale?.({ ...ctx, url: "/en/home" })).toBe("en");
      expect(hooks.detectLocale?.({ ...ctx, url: "/fr/home" })).toBeUndefined();
    });
  });

  // ── Codegen Adapter Behavior ────────────────────────────────────────────────

  describe("codegen adapter behavior", () => {
    it("react wrapJsxRichText wraps with dangerouslySetInnerHTML", () => {
      const { hooks } = resolveAdapters(["react"]);
      const reactCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".tsx"))!;
      expect(reactCodegen.wrapJsxRichText?.("<b>hello</b>")).toBe(
        `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: <b>hello</b> }} />`,
      );
    });

    it("vue wrapHtmlText with tags uses v-html", () => {
      const { hooks } = resolveAdapters(["vue"]);
      const vueCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("text", true, true)).toBe(`<span v-html="text"></span>`);
    });

    it("vue wrapHtmlText without tags uses mustache", () => {
      const { hooks } = resolveAdapters(["vue"]);
      const vueCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{{ t('key') }}`);
    });

    it("vue wrapHtmlAttribute uses :attr binding", () => {
      const { hooks } = resolveAdapters(["vue"]);
      const vueCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `:title="t('myTitle')"`,
      );
    });

    it("svelte wrapHtmlText with tags uses {@html}", () => {
      const { hooks } = resolveAdapters(["svelte"]);
      const svelteCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("text", true, true)).toBe(`{@html text }`);
    });

    it("svelte wrapHtmlText without tags uses { expr }", () => {
      const { hooks } = resolveAdapters(["svelte"]);
      const svelteCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{ t('key') }`);
    });

    it("svelte wrapHtmlAttribute uses attr={} binding", () => {
      const { hooks } = resolveAdapters(["svelte"]);
      const svelteCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `title={t('myTitle')}`,
      );
    });

    it("vue wrapSfcScript wraps with script setup", () => {
      const { hooks } = resolveAdapters(["vue"]);
      const vueCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapSfcScript?.('import { t } from "zintl"')).toBe(
        `<script setup lang="ts">\nimport { t } from "zintl"</script>\n`,
      );
    });

    it("svelte wrapSfcScript wraps with script", () => {
      const { hooks } = resolveAdapters(["svelte"]);
      const svelteCodegen = hooks.codegenAdapters.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapSfcScript?.('import { t } from "zintl"')).toBe(
        `<script>\nimport { t } from "zintl"</script>\n`,
      );
    });
  });

  // ── User-Authored Partial Adapters ──────────────────────────────────────────

  describe("user-authored partial adapters", () => {
    it("accepts minimal adapter with only name", () => {
      const minimal: ZintlAdapter = { name: "my-minimal" };
      expect(() => resolveAdapters([minimal])).not.toThrow();
    });

    it("accepts adapter with only codegen sub-interface", () => {
      const astro: ZintlAdapter = {
        name: "astro",
        codegen: {
          extensions: [".astro"],
          match: (f) => f.endsWith(".astro"),
          wrapHtmlText: (r) => `{${r}}`,
        },
      };
      const { capabilities, hooks } = resolveAdapters([astro]);
      expect(capabilities.sfc).toBe(false); // no wrapSfcScript
      const matched = hooks.codegenAdapters.find((a) => a.match("src/page.astro"));
      expect(matched).toBeDefined();
      expect(matched?.wrapHtmlText?.("t('key')", false, true)).toBe(`{t('key')}`);
    });

    it("registers and uses a custom preset", () => {
      const myAdapter: ZintlAdapter = {
        name: "my-framework-codegen",
        codegen: {
          extensions: [".mf"],
          match: (f) => f.endsWith(".mf"),
        },
      };
      registerPreset("my-framework", () => [myAdapter]);
      const { adapters } = resolveAdapters(["my-framework"]);
      expect(adapters.some((a) => a.name === "my-framework-codegen")).toBe(true);
    });
  });

  // ── SSR Adapter Behavior ────────────────────────────────────────────────────

  describe("SSR adapter behavior", () => {
    it("nextjs ssrWrapCode wraps export function render()", () => {
      const { hooks } = resolveAdapters(["nextjs"]);
      const code = `export async function render(url, manifest) { return "<html>" }`;
      const result = hooks.ssrWrapCode?.({
        code,
        fileId: "src/entry-server.ts",
        isEntry: true,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      expect(result).toContain("_zintl_raw_render");
      expect(result).toContain("_zintl_runInRequestScope");
      expect(result).toContain('["en","ar"]');
    });

    it("nextjs ssrWrapCode is idempotent (skips already-wrapped code)", () => {
      const { hooks } = resolveAdapters(["nextjs"]);
      const code = `export async function render(url) { return "" }`;
      const wrapped = hooks.ssrWrapCode!({
        code,
        fileId: "src/entry-server.ts",
        isEntry: true,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      // Second call should return undefined (already wrapped)
      const reWrapped = hooks.ssrWrapCode?.({
        code: wrapped!,
        fileId: "src/entry-server.ts",
        isEntry: true,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      expect(reWrapped).toBeUndefined();
    });

    it("nextjs ssrWrapCode skips non-entry files", () => {
      const { hooks } = resolveAdapters(["nextjs"]);
      const code = `export function render() {}`;
      const result = hooks.ssrWrapCode?.({
        code,
        fileId: "src/components/Button.tsx",
        isEntry: false,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      expect(result).toBeUndefined();
    });
  });
});
