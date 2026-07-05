import { describe, it, expect } from "vite-plus/test";
import { resolveFacets, registerPreset } from "../../facet/index.js";
import type { ZintlFacet } from "../../facet/index.js";

describe("Facet Resolution Engine", () => {
  // ── Preset Expansion ────────────────────────────────────────────────────────

  describe("preset expansion", () => {
    it("expands 'react' preset to extraction + codegen facets", () => {
      const { facets } = resolveFacets(["react"]);
      expect(facets.some((a) => a.name === "react-extraction")).toBe(true);
      expect(facets.some((a) => a.name === "react-codegen")).toBe(true);
    });

    it("expands 'vue' preset to extraction + codegen facets", () => {
      const { facets } = resolveFacets(["vue"]);
      expect(facets.some((a) => a.name === "vue-extraction")).toBe(true);
      expect(facets.some((a) => a.name === "vue-codegen")).toBe(true);
    });

    it("expands 'svelte' preset to extraction + codegen facets", () => {
      const { facets } = resolveFacets(["svelte"]);
      expect(facets.some((a) => a.name === "svelte-extraction")).toBe(true);
      expect(facets.some((a) => a.name === "svelte-codegen")).toBe(true);
    });

    it("expands 'nextjs' preset to react + nextjs-ssr facets", () => {
      const { facets } = resolveFacets(["nextjs"]);
      expect(facets.some((a) => a.name === "react-extraction")).toBe(true);
      expect(facets.some((a) => a.name === "react-codegen")).toBe(true);
      expect(facets.some((a) => a.name === "nextjs-ssr-wrapping")).toBe(true);
    });

    it("throws on unknown preset name", () => {
      expect(() => resolveFacets(["unknown-framework-xyz"])).toThrow(
        /Unknown facet preset or target descriptor "unknown-framework-xyz"/,
      );
    });

    it("throws with a list of known presets in the error", () => {
      expect(() => resolveFacets(["unknown"])).toThrow(/Known presets:/);
    });
  });

  // ── Capability Resolution ───────────────────────────────────────────────────

  describe("ResolvedCapabilities", () => {
    it("vanilla adapter has no jsx/sfc/ssr/hmr capabilities", () => {
      const { capabilities } = resolveFacets(["vanilla"]);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.sfc).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
      expect(capabilities.ssr).toBe(false);
      expect(capabilities.hmr).toBe(false);
    });

    it("react adapter enables jsx capability", () => {
      const { capabilities } = resolveFacets(["react"]);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.jsxRichText).toBe(true);
      expect(capabilities.sfc).toBe(false);
    });

    it("vue adapter enables sfc capability", () => {
      const { capabilities } = resolveFacets(["vue"]);
      expect(capabilities.sfc).toBe(true);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
    });

    it("svelte adapter enables sfc capability", () => {
      const { capabilities } = resolveFacets(["svelte"]);
      expect(capabilities.sfc).toBe(true);
    });

    it("ssr adapter enables serverRequestScope and streaming", () => {
      const { capabilities } = resolveFacets(["ssr"]);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.ssr).toBe(true);
    });

    it("client-spa adapter enables clientLocaleSync", () => {
      const { capabilities } = resolveFacets(["client-spa"]);
      expect(capabilities.clientLocaleSync).toBe(true);
      expect(capabilities.localeRouting).toBe(true);
    });

    it("vite adapter enables hmr capability", () => {
      const { capabilities } = resolveFacets(["vite"]);
      expect(capabilities.hmr).toBe(true);
    });

    it("nextjs adapter enables ssr + jsx + serverRequestScope + streaming", () => {
      const { capabilities } = resolveFacets(["nextjs"]);
      expect(capabilities.ssr).toBe(true);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
    });

    it("empty facets produces all-false capabilities", () => {
      const { capabilities } = resolveFacets([]);
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

    it("ssr boolean is OR-merged across multiple facets", () => {
      const { capabilities } = resolveFacets(["react", "ssr"]);
      expect(capabilities.ssr).toBe(true);
      expect(capabilities.jsx).toBe(true);
    });
  });

  // ── Deterministic Merge & Priorities ────────────────────────────────────────

  describe("priority and deterministic merge", () => {
    it("resolveVirtualPath hook is ordering-independent due to priority", () => {
      const myBundler: ZintlFacet = {
        name: "my-bundler",
        concern: "bundler",
        priority: 50,
        resolveVirtualPath: (id) => `\0${id}`,
      };
      // Order 1: myBundler first
      const r1 = resolveFacets([myBundler]);
      // Order 2: vanilla first then myBundler
      const r2 = resolveFacets(["vanilla", myBundler]);
      expect(r1.system.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
      expect(r2.system.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
    });

    it("runtime booleans are OR-merged across facets regardless of order", () => {
      const { capabilities: c1 } = resolveFacets(["ssr", "client-spa"]);
      const { capabilities: c2 } = resolveFacets(["client-spa", "ssr"]);
      expect(c1.serverRequestScope).toBe(true);
      expect(c1.clientLocaleSync).toBe(true);
      expect(c2.serverRequestScope).toBe(true);
      expect(c2.clientLocaleSync).toBe(true);
    });

    it("extraction targets are unioned across facets", () => {
      const { system } = resolveFacets(["vanilla", "html"]);
      expect(system.extractionTargets).toContain("dom:prop:innerHTML");
      expect(system.extractionTargets).toContain("html:attr:alt");
    });

    it("extensions are unioned across facets", () => {
      const { system } = resolveFacets(["vue", "react"]);
      expect(system.extensions).toContain(".vue");
      expect(system.extensions).toContain(".tsx");
      expect(system.extensions).toContain(".jsx");
    });

    it("higher priority hook overrides lower priority hook without conflict", () => {
      const bundlerA: ZintlFacet = {
        name: "bundler-a",
        concern: "bundler",
        priority: 200,
        resolveVirtualPath: (id) => `a:${id}`,
      };
      const bundlerB: ZintlFacet = {
        name: "bundler-b",
        concern: "bundler",
        priority: 100,
        resolveVirtualPath: (id) => `b:${id}`,
      };
      const { system } = resolveFacets([bundlerA, bundlerB]);
      expect(system.resolveVirtualPath("foo")).toBe("a:foo");
    });
  });

  // ── Conflict Detection ──────────────────────────────────────────────────────

  describe("conflict detection", () => {
    it("throws when two facets claim the same extension for codegen at same priority", () => {
      const adapterA: ZintlFacet = {
        name: "adapter-a",
        concern: "codegen",
        priority: 50,
        extensions: [".custom"],
        match: (f) => f.endsWith(".custom"),
      };
      const adapterB: ZintlFacet = {
        name: "adapter-b",
        concern: "codegen",
        priority: 50,
        extensions: [".custom"],
        match: (f) => f.endsWith(".custom"),
      };
      expect(() => resolveFacets([adapterA, adapterB])).toThrow(/Facet conflict/);
      expect(() => resolveFacets([adapterA, adapterB])).toThrow(/adapter-b/);
    });

    it("does not throw when two facets claim the same extension at different priorities", () => {
      const adapterA: ZintlFacet = {
        name: "adapter-a",
        concern: "codegen",
        priority: 150,
        extensions: [".custom"],
        match: (f) => f.endsWith(".custom"),
        wrapHtmlText: () => "a",
      };
      const adapterB: ZintlFacet = {
        name: "adapter-b",
        concern: "codegen",
        priority: 50,
        extensions: [".custom"],
        match: (f) => f.endsWith(".custom"),
        wrapHtmlText: () => "b",
      };
      const { system } = resolveFacets([adapterA, adapterB]);
      const matched = system.codegenFacets.find((a) => a.match("foo.custom"));
      expect(matched?.wrapHtmlText?.("val", false, false)).toBe("a");
    });

    it("throws when two facets both provide bundler.dynamicImportTemplate at same priority", () => {
      const bundlerA: ZintlFacet = {
        name: "bundler-a",
        concern: "bundler",
        priority: 50,
        dynamicImportTemplate: (p) => `import("${p}")`,
      };
      const bundlerB: ZintlFacet = {
        name: "bundler-b",
        concern: "bundler",
        priority: 50,
        dynamicImportTemplate: (p) => `require("${p}")`,
      };
      expect(() => resolveFacets([bundlerA, bundlerB])).toThrow(/Facet conflict/);
      expect(() => resolveFacets([bundlerA, bundlerB])).toThrow(/bundler-b/);
    });

    it("throws when two facets both provide ssr.wrapCode at same priority", () => {
      const ssrA: ZintlFacet = {
        name: "ssr-a",
        concern: "ssr",
        priority: 50,
        wrapCode: () => "wrapped",
      };
      const ssrB: ZintlFacet = {
        name: "ssr-b",
        concern: "ssr",
        priority: 50,
        wrapCode: () => "also wrapped",
      };
      expect(() => resolveFacets([ssrA, ssrB])).toThrow(/Facet conflict/);
    });

    it("throws when two facets both provide bundler.resolveVirtualPath at same priority", () => {
      const bundlerA: ZintlFacet = {
        name: "bundler-a",
        concern: "bundler",
        priority: 50,
        resolveVirtualPath: (id) => `\0${id}`,
      };
      const bundlerB: ZintlFacet = {
        name: "bundler-b",
        concern: "bundler",
        priority: 50,
        resolveVirtualPath: (id) => id + "?resolved",
      };
      expect(() => resolveFacets([bundlerA, bundlerB])).toThrow(/Facet conflict/);
    });
  });

  // ── Merged Hooks ────────────────────────────────────────────────────────────

  describe("ResolvedFacetSystem", () => {
    it("resolveVirtualPath has a default passthrough when no bundler adapter", () => {
      const { system } = resolveFacets(["vanilla"]);
      expect(system.resolveVirtualPath("virtual:zintl/content")).toBe("virtual:zintl/content");
    });

    it("dynamicImportTemplate has a default when no bundler adapter", () => {
      const { system } = resolveFacets(["vanilla"]);
      expect(system.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("vite adapter provides @vite-ignore comment in dev mode", () => {
      const { system } = resolveFacets(["vite"]);
      expect(system.dynamicImportTemplate("./foo", true)).toBe(
        `import(/* @vite-ignore */ "./foo")`,
      );
      expect(system.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("codegenFacets has correct facets for vue+react combo", () => {
      const { system } = resolveFacets(["vue", "react"]);
      const vueAdapter = system.codegenFacets.find((a) => a.extensions.includes(".vue"));
      const reactAdapter = system.codegenFacets.find((a) => a.extensions.includes(".tsx"));
      expect(vueAdapter).toBeDefined();
      expect(reactAdapter).toBeDefined();
    });

    it("vue codegen match works correctly", () => {
      const { system } = resolveFacets(["vue", "react"]);
      const matched = system.codegenFacets.find((a) => a.match("src/App.vue"));
      expect(matched?.extensions).toContain(".vue");
    });

    it("react codegen match works correctly", () => {
      const { system } = resolveFacets(["vue", "react"]);
      const matched = system.codegenFacets.find((a) => a.match("src/Button.tsx"));
      expect(matched?.extensions).toContain(".tsx");
    });

    it("ssrEntryTargets are unioned across facets", () => {
      const customSsr: ZintlFacet = {
        name: "custom-ssr",
        concern: "ssr",
        priority: 50,
        entryTargets: ["my-custom-entry"],
      };
      const { system } = resolveFacets(["nextjs", customSsr]);
      expect(system.ssrEntryTargets).toContain("virtual:vinext-rsc-entry");
      expect(system.ssrEntryTargets).toContain("my-custom-entry");
    });

    it("detectLocale is chained — first non-undefined result wins", () => {
      const adapterA: ZintlFacet = {
        name: "detect-a",
        concern: "runtime",
        priority: 50,
        detectLocale: ({ url }) => (url?.includes("/ar/") ? "ar" : undefined),
      };
      const adapterB: ZintlFacet = {
        name: "detect-b",
        concern: "runtime",
        priority: 50,
        detectLocale: ({ url }) => (url?.includes("/en/") ? "en" : undefined),
      };
      const { system } = resolveFacets([adapterA, adapterB]);
      const ctx = { locales: ["en", "ar"], defaultLocale: "en" };
      expect(system.detectLocale?.({ ...ctx, url: "/ar/home" })).toBe("ar");
      expect(system.detectLocale?.({ ...ctx, url: "/en/home" })).toBe("en");
      expect(system.detectLocale?.({ ...ctx, url: "/fr/home" })).toBeUndefined();
    });
  });

  // ── Codegen Adapter Behavior ────────────────────────────────────────────────

  describe("codegen adapter behavior", () => {
    it("react wrapJsxRichText wraps with dangerouslySetInnerHTML", () => {
      const { system } = resolveFacets(["react"]);
      const reactCodegen = system.codegenFacets.find((a) => a.extensions.includes(".tsx"))!;
      expect(reactCodegen.wrapJsxRichText?.("<b>hello</b>")).toBe(
        `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: <b>hello</b> }} />`,
      );
    });

    it("vue wrapHtmlText with tags uses v-html", () => {
      const { system } = resolveFacets(["vue"]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("text", true, true)).toBe(`<span v-html="text"></span>`);
    });

    it("vue wrapHtmlText without tags uses mustache", () => {
      const { system } = resolveFacets(["vue"]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{{ t('key') }}`);
    });

    it("vue wrapHtmlAttribute uses :attr binding", () => {
      const { system } = resolveFacets(["vue"]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `:title="t('myTitle')"`,
      );
    });

    it("svelte wrapHtmlText with tags uses {@html}", () => {
      const { system } = resolveFacets(["svelte"]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("text", true, true)).toBe(`{@html text }`);
    });

    it("svelte wrapHtmlText without tags uses { expr }", () => {
      const { system } = resolveFacets(["svelte"]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{ t('key') }`);
    });

    it("svelte wrapHtmlAttribute uses attr={} binding", () => {
      const { system } = resolveFacets(["svelte"]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `title={t('myTitle')}`,
      );
    });

    it("vue wrapSfcScript wraps with script setup", () => {
      const { system } = resolveFacets(["vue"]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapSfcScript?.('import { t } from "zintl"')).toBe(
        `<script setup lang="ts">\nimport { t } from "zintl"</script>\n`,
      );
    });

    it("svelte wrapSfcScript wraps with script", () => {
      const { system } = resolveFacets(["svelte"]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapSfcScript?.('import { t } from "zintl"')).toBe(
        `<script>\nimport { t } from "zintl"</script>\n`,
      );
    });
  });

  // ── User-Authored Partial Adapters ──────────────────────────────────────────

  describe("user-authored partial facets", () => {
    it("accepts minimal adapter with only name and concern", () => {
      const minimal: ZintlFacet = { name: "my-minimal", concern: "runtime" };
      expect(() => resolveFacets([minimal])).not.toThrow();
    });

    it("accepts adapter with only codegen contribution", () => {
      const astro: ZintlFacet = {
        name: "astro",
        concern: "codegen",
        extensions: [".astro"],
        match: (f) => f.endsWith(".astro"),
        wrapHtmlText: (r) => `{${r}}`,
      };
      const { capabilities, system } = resolveFacets([astro]);
      expect(capabilities.sfc).toBe(false);
      const matched = system.codegenFacets.find((a) => a.match("src/page.astro"));
      expect(matched).toBeDefined();
      expect(matched?.wrapHtmlText?.("t('key')", false, true)).toBe(`{t('key')}`);
    });

    it("registers and uses a custom preset", () => {
      const myAdapter: ZintlFacet = {
        name: "my-framework-codegen",
        concern: "codegen",
        extensions: [".mf"],
        match: (f) => f.endsWith(".mf"),
      };
      registerPreset("my-framework", () => [myAdapter]);
      const { facets } = resolveFacets(["my-framework"]);
      expect(facets.some((a) => a.name === "my-framework-codegen")).toBe(true);
    });
  });

  // ── Preset Objects & Nesting ────────────────────────────────────────────────

  describe("nesting and array input resolution", () => {
    it("resolves nested arrays of facets", () => {
      const { facets } = resolveFacets([
        [
          "vite",
          [
            {
              name: "inner-codegen",
              concern: "codegen",
              extensions: [".abc"],
              match: (f: string) => f.endsWith(".abc"),
            },
          ],
          {
            name: "direct-runtime",
            concern: "runtime",
            clientLocaleSync: true,
          },
        ],
      ]);
      expect(facets.some((a) => a.name === "vite")).toBe(true);
      expect(facets.some((a) => a.name === "inner-codegen")).toBe(true);
      expect(facets.some((a) => a.name === "direct-runtime")).toBe(true);
    });
  });

  // ── SSR Adapter Behavior ────────────────────────────────────────────────────

  describe("SSR adapter behavior", () => {
    it("nextjs ssrWrapCode wraps export function render()", () => {
      const { system } = resolveFacets(["nextjs"]);
      const code = `export async function render(url, manifest) { return "<html>" }`;
      const result = system.ssrWrapCode?.({
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
      const { system } = resolveFacets(["nextjs"]);
      const code = `export async function render(url) { return "" }`;
      const wrapped = system.ssrWrapCode!({
        code,
        fileId: "src/entry-server.ts",
        isEntry: true,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      // Second call should return undefined (already wrapped)
      const reWrapped = system.ssrWrapCode?.({
        code: wrapped!,
        fileId: "src/entry-server.ts",
        isEntry: true,
        locales: ["en", "ar"],
        sourceLocale: "en",
      });
      expect(reWrapped).toBeUndefined();
    });

    it("nextjs ssrWrapCode skips non-entry files", () => {
      const { system } = resolveFacets(["nextjs"]);
      const code = `export function render() {}`;
      const result = system.ssrWrapCode?.({
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
