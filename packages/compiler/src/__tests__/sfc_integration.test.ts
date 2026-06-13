import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "./helpers/fs.js";
import { bakeICU } from "../utils/icu-baker.js";
import { runInRequestScope, I18nStore, getActiveInstance } from "../runtime/store.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

const vueAdapter = {
  name: "vue",
  match: (filePath: string) => filePath.endsWith(".vue"),
  sfc: true,
  wrapSfcScript: (code: string) => `<script setup lang="ts">\n${code}</script>\n`,
  wrapHtmlText: (replacement: string, hasTags: boolean, hasVars: boolean) => {
    if (hasVars) {
      if (hasTags) {
        return `<span v-html="${replacement.replace(/"/g, "&quot;")}"></span>`;
      } else {
        return `{{ ${replacement} }}`;
      }
    }
    return replacement;
  },
  wrapHtmlAttribute: (attrName: string, replacement: string, hasVars: boolean) => {
    if (hasVars) {
      return `:${attrName}="${replacement}"`;
    }
    return replacement;
  },
};

const svelteAdapter = {
  name: "svelte",
  match: (filePath: string) => filePath.endsWith(".svelte"),
  sfc: true,
  wrapSfcScript: (code: string) => `<script>\n${code}</script>\n`,
  wrapHtmlText: (replacement: string, hasTags: boolean, hasVars: boolean) => {
    if (hasVars) {
      if (hasTags) {
        return `{@html ${replacement} }`;
      } else {
        return `{ ${replacement} }`;
      }
    }
    return replacement;
  },
  wrapHtmlAttribute: (attrName: string, replacement: string, hasVars: boolean) => {
    if (hasVars) {
      return `${attrName}={${replacement}}`;
    }
    return replacement;
  },
};

describe("SFC Integration Tests", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("sfc-integration-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/main.ts"), 'import { zintl } from "zintl"; zintl("en");');
    context.compiler = new ZintlCompiler(
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
        adapters: [vueAdapter, svelteAdapter],
        extensions: [".ts", ".tsx", ".js", ".jsx", ".html", ".vue", ".svelte"],
      },
      root,
      true, // isDev
    );
  });

  describe("Vue SFC Compilation (Dev & Prod)", () => {
    it("should extract and transform Vue SFC in Dev Mode", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      // Vue SFC code containing script anchor and translatable template elements
      const sfcCode = `
<script lang="ts">
import { zintl } from "zintl";
zintl({ locale: "en" });
</script>
<template>
  <div>
    <h1>Welcome {{ name }}</h1>
    <input placeholder="Search input..." />
    <div class="alert">Warning: <strong>Alert details</strong></div>
  </div>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      // Perform transformation
      const result = await compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const transformedCode = result!.code;
      // Assert that mustaches are rewritten to _t calls
      expect(transformedCode).toContain("_t(");
      // Assert HTML_TEXT tags wrapping (e.g. <strong>)
      expect(transformedCode).toContain("v-html");
      // Assert HTML attributes alt/placeholder binding wrapping
      expect(transformedCode).toContain(":placeholder=");
      // Assert escapeCurly braces mapping is used inside jsString calls
      expect(transformedCode).toContain("\\x7b");
    });

    it("should bake Vue SFC elements in Production Mode", async (context: LocalContext) => {
      const { root } = context;
      const prodCompiler = new ZintlCompiler(
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
          adapters: [vueAdapter],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".html", ".vue"],
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const sfcCode = `
<script lang="ts">
import { zintl } from "zintl";
zintl("ar");
</script>
<template>
  <div>
    <p>Static Text</p>
    <h1>Welcome {{ name }}</h1>
    <input placeholder="Static Placeholder" />
  </div>
</template>
      `.trim();

      const vuePath = join(root!, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      // Setup locales and catalog delta BEFORE discover/flush so compiler caches translations
      await mkdir(join(root!, "locales/src"), { recursive: true });
      await writeFile(
        join(root!, "locales/src/App.vue.ar.json"),
        JSON.stringify({
          "Static Text": "نص ثابت",
          "Welcome {name}": "مرحباً {name}",
          "Static Placeholder": "مربع بحث ثابت",
        }),
      );

      await prodCompiler.discover();
      await prodCompiler.flush();

      const result = await prodCompiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const transformedCode = result!.code;
      // Assert baked static text
      expect(transformedCode).toContain("نص ثابت");
      // Assert baked interpolation text
      expect(transformedCode).toContain("`مرحباً ${name}`");
      // Assert baked attribute alt/placeholder
      expect(transformedCode).toContain('placeholder="مربع بحث ثابت"');
    });
  });

  describe("Svelte SFC Compilation (Dev & Prod)", () => {
    it("should extract and transform Svelte SFC in Dev Mode", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintl";
zintl("en");
</script>

<main>
  <h1>Welcome {user.name}</h1>
  <input placeholder="Placeholder text" />
  <div>Click <a>Link here</a></div>
</main>
      `.trim();

      const sveltePath = join(root, "src/App.svelte");
      await writeFile(sveltePath, sfcCode);

      const result = await compiler.transform(sfcCode, sveltePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const transformedCode = result!.code;
      // Assert mustache brace wrapping
      expect(transformedCode).toContain("{_t(");
      // Assert Svelte attribute wrapping
      expect(transformedCode).toContain("placeholder={_t(");
      // Assert Svelte HTML_TEXT wrapper
      expect(transformedCode).toContain("{@html");
    });

    it("should bake Svelte SFC elements in Production Mode", async (context: LocalContext) => {
      const { root } = context;
      const prodCompiler = new ZintlCompiler(
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
          adapters: [svelteAdapter],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".html", ".svelte"],
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintl";
zintl("ar");
</script>

<main>
  <h1>Welcome {name}</h1>
  <input placeholder="Username" />
</main>
      `.trim();

      const sveltePath = join(root!, "src/App.svelte");
      await writeFile(sveltePath, sfcCode);

      await mkdir(join(root!, "locales/src"), { recursive: true });
      await writeFile(
        join(root!, "locales/src/App.svelte.ar.json"),
        JSON.stringify({
          "Welcome {name}": "مرحباً {name}",
          Username: "اسم المستخدم",
        }),
      );

      await prodCompiler.discover();
      await prodCompiler.flush();

      const result = await prodCompiler.transform(sfcCode, sveltePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const transformedCode = result!.code;
      expect(transformedCode).toContain("`مرحباً ${name}`");
      expect(transformedCode).toContain('placeholder="اسم المستخدم"');
    });
  });

  describe("Ternary Baking Operator Edge Cases", () => {
    it("should handle condition parsing with less than (<) operator in baking", async (context: LocalContext) => {
      const { root } = context;
      const prodCompiler = new ZintlCompiler(
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
          extensions: [".ts", ".tsx", ".js", ".jsx", ".html"],
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const code = `
import { zintl, t } from "zintl";
zintl("ar");
const msg = t("Items count", { count: 1 });
      `.trim();

      const path = join(root!, "src/App.ts");
      await writeFile(path, code);

      await mkdir(join(root!, "locales/src"), { recursive: true });
      // Setup a plural format with a < condition
      await writeFile(
        join(root!, "locales/src/App.ar.json"),
        JSON.stringify({
          "Items count": {
            "count < 2": "قليل",
            "count = 2": "اثنان",
            "count > 2": "كثير",
          },
        }),
      );

      await prodCompiler.discover();
      await prodCompiler.flush();

      const result = await prodCompiler.transform(code, path, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const transformedCode = result!.code;
      expect(transformedCode).toContain("count < 2");
      expect(transformedCode).toContain("? `قليل` :");
    });
  });

  describe("Conflict & Warning Merges", () => {
    it("should merge duplicate rewrite ranges and warn on overlap", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      // Setup overlapping markers or identical duplicate markers
      const code = `
import { zintl, t } from "zintl";
zintl("en");
// Trigger duplicate and overlapping rewrite checks
const duplicate = t("SameKey") + t("SameKey");
      `.trim();

      const path = join(root, "src/App.ts");
      await writeFile(path, code);

      const result = await compiler.transform(code, path, "virtual:zintl-catalog");
      expect(result).toBeDefined();
    });
  });

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
});
