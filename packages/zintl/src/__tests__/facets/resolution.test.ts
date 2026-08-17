import { describe, it, expect } from "vite-plus/test";
import { resolveFacets } from "../../facets/resolve.js";
import {
  vanillaFacet,
  reactExtractionFacet,
  reactCodegenFacet,
  reactRuntimeFacet,
  reactFacet,
  vueExtractionFacet,
  vueCodegenFacet,
  vueFacet,
  svelteExtractionFacet,
  svelteCodegenFacet,
  svelteFacet,
  htmlExtractionFacet,
  htmlFacet,
  nextjsSsrFacet,
  nextjsExtractionFacet,
  nextjsRuntimeFacet,
  nextjsFacet,
  ssrWrappingFacet,
  ssrRuntimeFacet,
  ssrFacet,
  clientSpaFacet,
  viteFacet,
} from "@zintljs/compiler/facets";
import type { ZintlFacet } from "@zintljs/compiler";

describe("Facet Resolution Engine", () => {
  // ── Basic Resolution ───────────────────────────────────────────────────────

  describe("basic resolution", () => {
    it("deduplicates and returns input facets", () => {
      const { facets } = resolveFacets([reactExtractionFacet(), reactCodegenFacet()]);
      expect(facets.some((a) => a.name === "react-extraction")).toBe(true);
      expect(facets.some((a) => a.name === "react-codegen")).toBe(true);
    });
  });

  // ── Capability Resolution ───────────────────────────────────────────────────

  describe("ResolvedCapabilities", () => {
    it("vanilla adapter has no jsx/sfc/ssr/hmr capabilities", () => {
      const { flags: capabilities } = resolveFacets([vanillaFacet()]);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.sfc).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
      expect(capabilities.ssr).toBe(false);
      expect(capabilities.hmr).toBe(false);
    });

    it("react adapter enables jsx capability", () => {
      const { flags: capabilities } = resolveFacets([reactExtractionFacet(), reactCodegenFacet()]);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.jsxRichText).toBe(true);
      expect(capabilities.sfc).toBe(false);
    });

    it("vue adapter enables sfc capability", () => {
      const { flags: capabilities } = resolveFacets([vueExtractionFacet(), vueCodegenFacet()]);
      expect(capabilities.sfc).toBe(true);
      expect(capabilities.jsx).toBe(false);
      expect(capabilities.jsxRichText).toBe(false);
    });

    it("svelte adapter enables sfc capability", () => {
      const { flags: capabilities } = resolveFacets([
        svelteExtractionFacet(),
        svelteCodegenFacet(),
      ]);
      expect(capabilities.sfc).toBe(true);
    });

    it("ssr adapter enables serverRequestScope and streaming", () => {
      const { flags: capabilities } = resolveFacets([ssrWrappingFacet(), ssrRuntimeFacet()]);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.ssr).toBe(true);
    });

    it("client-spa adapter enables clientLocaleSync", () => {
      const { flags: capabilities } = resolveFacets([clientSpaFacet()]);
      expect(capabilities.clientLocaleSync).toBe(true);
      expect(capabilities.localeRouting).toBe(true);
    });

    it("vite adapter enables hmr capability", () => {
      const { flags: capabilities } = resolveFacets([viteFacet()]);
      expect(capabilities.hmr).toBe(true);
    });

    it("nextjs adapter enables ssr + jsx + serverRequestScope + streaming", () => {
      const { flags: capabilities } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        nextjsExtractionFacet(),
        nextjsSsrFacet(),
        nextjsRuntimeFacet(),
      ]);
      expect(capabilities.ssr).toBe(true);
      expect(capabilities.jsx).toBe(true);
      expect(capabilities.serverRequestScope).toBe(true);
      expect(capabilities.streaming).toBe(true);
    });

    it("empty facets produces all-false capabilities", () => {
      const { flags: capabilities } = resolveFacets([]);
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
      const { flags: capabilities } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        ssrWrappingFacet(),
        ssrRuntimeFacet(),
      ]);
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
      const r2 = resolveFacets([vanillaFacet(), myBundler]);
      expect(r1.system.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
      expect(r2.system.resolveVirtualPath("virtual:foo")).toBe("\0virtual:foo");
    });

    it("runtime booleans are OR-merged across facets regardless of order", () => {
      const { flags: c1 } = resolveFacets([ssrRuntimeFacet(), clientSpaFacet()]);
      const { flags: c2 } = resolveFacets([clientSpaFacet(), ssrRuntimeFacet()]);
      expect(c1.serverRequestScope).toBe(true);
      expect(c1.clientLocaleSync).toBe(true);
      expect(c2.serverRequestScope).toBe(true);
      expect(c2.clientLocaleSync).toBe(true);
    });

    it("extraction targets are unioned across facets", () => {
      const { system } = resolveFacets([vanillaFacet(), htmlExtractionFacet()]);
      expect(system.extractionTargets).toContain("dom:prop:innerHTML");
      expect(system.extractionTargets).toContain("html:attr:alt");
    });

    it("extensions are unioned across facets", () => {
      const { system } = resolveFacets([
        vueExtractionFacet(),
        vueCodegenFacet(),
        reactExtractionFacet(),
        reactCodegenFacet(),
      ]);
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
      const { system } = resolveFacets([vanillaFacet()]);
      expect(system.resolveVirtualPath("virtual:zintl/content")).toBe("virtual:zintl/content");
    });

    it("dynamicImportTemplate has a default when no bundler adapter", () => {
      const { system } = resolveFacets([vanillaFacet()]);
      expect(system.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("vite adapter provides @vite-ignore comment in dev mode", () => {
      const { system } = resolveFacets([viteFacet()]);
      expect(system.dynamicImportTemplate("./foo", true)).toBe(
        `import(/* @vite-ignore */ "./foo")`,
      );
      expect(system.dynamicImportTemplate("./foo", false)).toBe(`import("./foo")`);
    });

    it("codegenFacets has correct facets for vue+react combo", () => {
      const { system } = resolveFacets([
        vueExtractionFacet(),
        vueCodegenFacet(),
        reactExtractionFacet(),
        reactCodegenFacet(),
      ]);
      const vueAdapter = system.codegenFacets.find((a) => a.extensions.includes(".vue"));
      const reactAdapter = system.codegenFacets.find((a) => a.extensions.includes(".tsx"));
      expect(vueAdapter).toBeDefined();
      expect(reactAdapter).toBeDefined();
    });

    it("vue codegen match works correctly", () => {
      const { system } = resolveFacets([
        vueExtractionFacet(),
        vueCodegenFacet(),
        reactExtractionFacet(),
        reactCodegenFacet(),
      ]);
      const matched = system.codegenFacets.find((a) => a.match("src/App.vue"));
      expect(matched?.extensions).toContain(".vue");
    });

    it("react codegen match works correctly", () => {
      const { system } = resolveFacets([
        vueExtractionFacet(),
        vueCodegenFacet(),
        reactExtractionFacet(),
        reactCodegenFacet(),
      ]);
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
      const { system } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        nextjsExtractionFacet(),
        nextjsSsrFacet(),
        nextjsRuntimeFacet(),
        customSsr,
      ]);
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
      const { system } = resolveFacets([reactExtractionFacet(), reactCodegenFacet()]);
      const reactCodegen = system.codegenFacets.find((a) => a.extensions.includes(".tsx"))!;
      expect(reactCodegen.wrapJsxRichText?.("<b>hello</b>")).toBe(
        `<span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: <b>hello</b> }} />`,
      );
    });

    it("vue wrapHtmlText with tags uses v-html", () => {
      const { system } = resolveFacets([vueExtractionFacet(), vueCodegenFacet()]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("text", true, true)).toBe(`<span v-html="text"></span>`);
    });

    it("vue wrapHtmlText without tags uses mustache", () => {
      const { system } = resolveFacets([vueExtractionFacet(), vueCodegenFacet()]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{{ t('key') }}`);
    });

    it("vue wrapHtmlAttribute uses :attr binding", () => {
      const { system } = resolveFacets([vueExtractionFacet(), vueCodegenFacet()]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `:title="t('myTitle')"`,
      );
    });

    it("svelte wrapHtmlText with tags uses {@html}", () => {
      const { system } = resolveFacets([svelteExtractionFacet(), svelteCodegenFacet()]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("text", true, true)).toBe(`{@html text }`);
    });

    it("svelte wrapHtmlText without tags uses { expr }", () => {
      const { system } = resolveFacets([svelteExtractionFacet(), svelteCodegenFacet()]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlText?.("t('key')", false, true)).toBe(`{ t('key') }`);
    });

    it("svelte wrapHtmlAttribute uses attr={} binding", () => {
      const { system } = resolveFacets([svelteExtractionFacet(), svelteCodegenFacet()]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapHtmlAttribute?.("title", "t('myTitle')", true)).toBe(
        `title={t('myTitle')}`,
      );
    });

    it("vue wrapSfcScript wraps with script setup", () => {
      const { system } = resolveFacets([vueExtractionFacet(), vueCodegenFacet()]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      expect(vueCodegen.wrapSfcScript?.('import { t } from "zintljs"')).toBe(
        `<script setup lang="ts">\nimport { t } from "zintljs"</script>\n`,
      );
    });

    it("svelte wrapSfcScript wraps with script", () => {
      const { system } = resolveFacets([svelteExtractionFacet(), svelteCodegenFacet()]);
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(svelteCodegen.wrapSfcScript?.('import { t } from "zintljs"')).toBe(
        `<script>\nimport { t } from "zintljs"</script>\n`,
      );
    });

    /**
     * The composition golden files list codegen facets by name only, so a
     * `CodegenFacet` field is invisible there by construction — unlike a bundler
     * flag, which `flags:` records. This is the guard for L-053's field.
     */
    it("vue declares requiresScriptSetup and svelte does not", () => {
      const { system } = resolveFacets([
        vueExtractionFacet(),
        vueCodegenFacet(),
        svelteExtractionFacet(),
        svelteCodegenFacet(),
      ]);
      const vueCodegen = system.codegenFacets.find((a) => a.extensions.includes(".vue"))!;
      const svelteCodegen = system.codegenFacets.find((a) => a.extensions.includes(".svelte"))!;
      expect(vueCodegen.requiresScriptSetup).toBe(true);
      expect(svelteCodegen.requiresScriptSetup).toBeUndefined();
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
      const { flags: capabilities, system } = resolveFacets([astro]);
      expect(capabilities.sfc).toBe(false);
      const matched = system.codegenFacets.find((a) => a.match("src/page.astro"));
      expect(matched).toBeDefined();
      expect(matched?.wrapHtmlText?.("t('key')", false, true)).toBe(`{t('key')}`);
    });
  });

  // ── SSR Adapter Behavior ────────────────────────────────────────────────────

  describe("SSR adapter behavior", () => {
    it("nextjs ssrWrapCode wraps export function render()", () => {
      const { system } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        nextjsExtractionFacet(),
        nextjsSsrFacet(),
        nextjsRuntimeFacet(),
      ]);
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
      const { system } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        nextjsExtractionFacet(),
        nextjsSsrFacet(),
        nextjsRuntimeFacet(),
      ]);
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
      const { system } = resolveFacets([
        reactExtractionFacet(),
        reactCodegenFacet(),
        nextjsExtractionFacet(),
        nextjsSsrFacet(),
        nextjsRuntimeFacet(),
      ]);
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

  describe("compound facets", () => {
    it("reactFacet compiles to extraction, codegen and runtime facets", () => {
      const facets = reactFacet();
      expect(facets.length).toBe(3);
      expect(facets[0].name).toBe("react-extraction");
      expect(facets[1].name).toBe("react-codegen");
      expect(facets[2].name).toBe("react-runtime");
    });

    it("resolves a React entry as unsafe to re-execute", () => {
      expect(resolveFacets(reactFacet()).flags.entryReexecutionSafe).toBe(false);
      expect(resolveFacets([reactRuntimeFacet()]).flags.entryReexecutionSafe).toBe(false);
    });

    it("vueFacet compiles to extraction, codegen and runtime facets", () => {
      const facets = vueFacet();
      expect(facets.map((f) => f.name)).toEqual([
        "vue-extraction",
        "vue-codegen",
        // Declares that Vue redraws from a store update without the entry
        // re-running, which decides whether a catalog edit can be applied hot
        // or has to reload (ledger L-064).
        "vue-runtime",
      ]);
      expect(facets[2]).toMatchObject({ repaintsOnCatalogUpdate: true });
    });

    it("svelteFacet compiles to extraction, codegen and runtime facets", () => {
      const facets = svelteFacet();
      expect(facets.map((f) => f.name)).toEqual([
        "svelte-extraction",
        "svelte-codegen",
        // Declares that re-running a Svelte entry is unsafe: mount() appends.
        "svelte-runtime",
      ]);
    });

    it("htmlFacet compiles to htmlExtractionFacet and htmlProjectionFacet", () => {
      const facets = htmlFacet();
      expect(facets.length).toBe(2);
      expect(facets[0].name).toBe("html-extraction");
      expect(facets[1].name).toBe("system-html-projection");
    });

    it("nextjsFacet compiles to extraction, ssr, and runtime facets", () => {
      const facets = nextjsFacet();
      expect(facets.length).toBe(3);
      expect(facets[0].name).toBe("nextjs-extraction");
      expect(facets[1].name).toBe("nextjs-ssr-wrapping");
      expect(facets[2].name).toBe("nextjs-runtime");
    });

    it("ssrFacet compiles to ssr-wrapping and ssr-runtime facets", () => {
      const facets = ssrFacet();
      expect(facets.length).toBe(2);
      expect(facets[0].name).toBe("ssr-wrapping");
      expect(facets[1].name).toBe("ssr-runtime");
    });
  });
});
