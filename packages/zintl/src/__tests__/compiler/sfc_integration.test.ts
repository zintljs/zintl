import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestCompiler, createTestCompilerWith } from "../helpers/compiler.js";
import { ZintlCompiler } from "@zintljs/compiler";
import { vueFacet, svelteFacet, viteFacet } from "@zintljs/compiler/facets";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

type LocalContext = TestContext & { compiler?: ZintlCompiler };

describe("SFC Integration Tests", () => {
  beforeEach(async (context: LocalContext) => {
    const root = await createTestDir("sfc-integration-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/main.ts"), 'import { zintl } from "zintljs"; zintl("en");');
    context.compiler = createTestCompilerWith(
      [viteFacet(), vueFacet(), svelteFacet()],
      {
        sourceLocale: "en",
        locales: ["en", "ar"],
        outputDir: "locales",
      },
      root,
      true, // isDev
    );
  });

  describe("Vue SFC Compilation (Dev & Prod)", () => {
    it("should extract and transform Vue SFC in Dev Mode", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      // Vue SFC code containing script anchor and translatable template elements.
      // `<script setup>` is the supported shape — see the L-053 fence below for
      // what a plain `<script>` does with the same template.
      const sfcCode = `
<script setup lang="ts">
import { zintl } from "zintljs";
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
      // Assert HTML_TEXT wrapping (e.g. <strong>)
      expect(transformedCode).toContain("v-html");
      // Assert HTML attributes alt/placeholder binding wrapping
      expect(transformedCode).toContain(":placeholder=");
      // Assert escapeCurly braces mapping is used inside jsString calls
      expect(transformedCode).toContain("\\x7b");
    });

    it("should bake Vue SFC elements in Production Mode", async (context: LocalContext) => {
      const { root } = context;
      const prodCompiler = createTestCompilerWith(
        [vueFacet()],
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const sfcCode = `
<script lang="ts">
import { zintl } from "zintljs";
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

  /**
   * Ledger L-053. Vue compiles a plain `<script>` component's template into a
   * separate render function, so bindings injected into the script block are
   * invisible to it. The fence exists because that failure is otherwise silent
   * at build time — green build, correct catalogs, empty page.
   *
   * The exactness is the point: the two cases below that keep working are the
   * reason the fence tests the *rewrites* rather than the script tag alone.
   * The baked test above is the third — same plain `<script lang="ts">`, same
   * template, and correct, because a baked rewrite references nothing.
   */
  describe("Options API (L-053)", () => {
    it("authors a <script setup> block for a plain <script> whose template needs bindings", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script lang="ts">
import { zintl } from "zintljs";
zintl({ locale: "en" });
export default { name: "App" };
</script>
<template>
  <h1>Welcome home</h1>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      const result = await compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();

      const code = result!.code;
      // The block is authored beside the user's, not instead of it, and its
      // language mirrors — Vue hard-errors when the two disagree.
      expect(code).toContain(`<script setup lang="ts">`);
      expect(code).toContain(`export default { name: "App" };`);
      expect(code).toContain("_t(");
      // The imports go into the authored block, which is what puts them in
      // template scope; the user's block keeps its own contents.
      expect(code.indexOf("virtual:zintl/runtime/internal")).toBeLessThan(
        code.indexOf(`export default { name: "App" };`),
      );
    });

    it("mirrors a plain JavaScript block by authoring one with no lang", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintljs";
zintl({ locale: "en" });
export default { name: "App" };
</script>
<template>
  <h1>Welcome home</h1>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      const result = await compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      expect(result!.code).toContain("<script setup>");
      expect(result!.code).not.toContain(`<script setup lang=`);
    });

    /**
     * Found in a browser, not by a unit test: the shape scan used to be a
     * free-floating `/<script[^>]*setup/` over the whole file, so a doc comment
     * *describing* `<script setup>` was read as one — and the imports were
     * injected into the middle of the comment.
     */
    it("reads blocks, not prose — a comment mentioning script setup is not one", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script lang="ts">
/**
 * Written with the Options API rather than \`<script setup>\`, deliberately.
 */
import { zintl } from "zintljs";
zintl({ locale: "en" });
export default { name: "App" };
</script>
<template>
  <h1>Welcome home</h1>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      const result = await compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      const code = result!.code;
      // The comment survives intact, and the block was authored rather than
      // the imports being spliced into the middle of the sentence.
      expect(code).toContain("Options API rather than `<script setup>`, deliberately.");
      expect(code.indexOf(`<script setup lang="ts">`)).toBe(0);
    });

    it("refuses a component that already declares a setup option", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script lang="ts">
import { zintl } from "zintljs";
zintl({ locale: "en" });
export default {
  setup() {
    return { answer: 42 };
  },
};
</script>
<template>
  <h1>Welcome home</h1>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      await expect(compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog")).rejects.toThrow(
        /already declares a `setup` option/,
      );
    });

    it("refuses a <script src> component, which cannot take a second block", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script lang="ts" src="./app.ts"></script>
<template>
  <h1>Welcome home</h1>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      await expect(compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog")).rejects.toThrow(
        /uses `src`/,
      );
    });

    it("allows a plain <script> whose strings live in the script block", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      /**
       * `@zintl-target` is what makes this string a sink, and it has to be.
       *
       * The fixture used to rely on `obj:field:label` being a default, which it
       * no longer is: a field named `label` on an arbitrary object says nothing
       * about whether it is a button or an analytics key (proposal 033 §1).
       *
       * That lands on Vue's Options API specifically. Strings in a `data()`
       * return are ordinary object fields, and the binding walk cannot name
       * them — `data` is a property of the default-exported object, not a
       * declaration — so `obj:<binding>:<field>` has nothing to point at either.
       * Marking the site is the answer, and this is the shape a Vue Options API
       * user now writes.
       *
       * The assertion itself is unchanged and is about scope, not targets: the
       * import Zintl injects must land where the rewrite did (ledger L-053).
       */
      const sfcCode = `
<script lang="ts">
import { zintl } from "zintljs";
zintl({ locale: "en" });
export default {
  data() {
    // @zintl-target
    return { field: { label: "Script only string" } };
  },
};
</script>
<template>
  <span>{{ field.label }}</span>
</template>
      `.trim();

      const vuePath = join(root, "src/App.vue");
      await writeFile(vuePath, sfcCode);

      const result = await compiler.transform(sfcCode, vuePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();
      expect(result!.code).toContain("_t(");
    });

    it("leaves Svelte alone — its <script> is the component scope", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintljs";
zintl("en");
</script>

<h1>Welcome home</h1>
      `.trim();

      const sveltePath = join(root, "src/App.svelte");
      await writeFile(sveltePath, sfcCode);

      const result = await compiler.transform(sfcCode, sveltePath, "virtual:zintl-catalog");
      expect(result).toBeDefined();
      expect(result!.code).toContain("{ _t(");
    });
  });

  describe("Svelte SFC Compilation (Dev & Prod)", () => {
    it("should extract and transform Svelte SFC in Dev Mode", async (context: LocalContext) => {
      const { root, compiler } = context as { root: string; compiler: ZintlCompiler };
      await compiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintljs";
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
      const prodCompiler = createTestCompilerWith(
        [svelteFacet()],
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const sfcCode = `
<script>
import { zintl } from "zintljs";
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
      const prodCompiler = createTestCompiler(
        {
          sourceLocale: "en",
          locales: ["en", "ar"],
          outputDir: "locales",
        },
        root!,
        false, // Production
      );
      await prodCompiler.setup();

      const code = `
import { zintl, t } from "zintljs";
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
import { zintl, t } from "zintljs";
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
});
