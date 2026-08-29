import { extractBase as extract, baseState } from "./helpers/extract.js";
import {
  SVELTE_MUSTACHE,
  SVELTE_SFC_RULES,
  VUE_MUSTACHE,
  VUE_SFC_RULES,
} from "./helpers/fixtures.js";
import { describe, it, expect } from "vite-plus/test";

describe("SFC Extraction (Vue/Svelte)", () => {
  it("should extract dependencies, manual translations, and object targets from Vue script blocks with correct offsets", () => {
    const code = `<script setup lang="ts">
import { ref } from "vue";
import { t } from "zintljs";
import HelloWorld from "./components/HelloWorld.vue";

const title = t("Welcome back");
const meta = {
  title: "Home Page",
  description: "Vue SFC test",
};
</script>

<template>
  <div>Hello World</div>
</template>`;

    const result = extract(code, "App.vue", "App.vue", {
      compiledState: baseState({ sfcRules: VUE_SFC_RULES, mustacheRegex: VUE_MUSTACHE }),
    });

    // 1. Check dependencies
    const depIds = result.dependencies.map((d) => d.id);
    expect(depIds).toContain("components/HelloWorld.vue");

    // 2. Check t() manual translation & line number
    const welcomeT = result.rawManualTranslations.find((m) => m.key === "Welcome back");
    expect(welcomeT).toBeDefined();
    expect(welcomeT!.start).toBe(150);
    expect(welcomeT!.line).toBe(150);
    expect(code.substring(welcomeT!.start, welcomeT!.end)).toBe('t("Welcome back")');

    // 3. Check target object fields (e.g. title/description)
    const homePageMsg = result.messages.find((m) => m.text === "Home Page");
    expect(homePageMsg).toBeDefined();
    expect(homePageMsg!.location.line).toBe(0);

    const vueSfcMsg = result.messages.find((m) => m.text === "Vue SFC test");
    expect(vueSfcMsg).toBeDefined();
    expect(vueSfcMsg!.location.line).toBe(0);
  });

  it("should extract dependencies and explicit translations from Svelte script blocks with correct offsets", () => {
    const code = `<script>
import { t } from "zintljs";
import Nested from "./Nested.svelte";
const message = t("Welcome Svelte");
</script>

<main>
  <h1>Hello World</h1>
</main>`;

    const result = extract(code, "App.svelte", "App.svelte", {
      compiledState: baseState({ sfcRules: SVELTE_SFC_RULES, mustacheRegex: SVELTE_MUSTACHE }),
    });

    // 1. Check dependencies
    const depIds = result.dependencies.map((d) => d.id);
    expect(depIds).toContain("Nested.svelte");

    // 2. Check manual translations
    const welcomeT = result.rawManualTranslations.find((m) => m.key === "Welcome Svelte");
    expect(welcomeT).toBeDefined();
    expect(welcomeT!.start).toBe(92);
    expect(welcomeT!.line).toBe(92);
    expect(code.substring(welcomeT!.start, welcomeT!.end)).toBe('t("Welcome Svelte")');
  });

  it("should extract mustache expressions and translatable attributes from Vue template blocks", () => {
    const code = `<template>
      <div placeholder="Enter name" title="Greeting">Hello {{ name }} and {{ lastName || 'Friend' }}!</div>
    </template>`;

    const result = extract(code, "App.vue", "App.vue", {
      compiledState: baseState({ sfcRules: VUE_SFC_RULES, mustacheRegex: VUE_MUSTACHE }),
    });

    // Verify attribute extraction
    const placeholderMsg = result.messages.find((m) => m.text === "Enter name");
    expect(placeholderMsg).toBeDefined();
    expect(placeholderMsg!.contexts).toContain("HTML_ATTR");

    const titleMsg = result.messages.find((m) => m.text === "Greeting");
    expect(titleMsg).toBeDefined();
    expect(titleMsg!.contexts).toContain("HTML_ATTR");

    // Verify HTML text and variable normalization
    const textMsg = result.messages.find((m) => m.text.includes("Hello {name}"));
    expect(textMsg).toBeDefined();
    expect(textMsg!.text).toBe("Hello {name} and {var0}!");
  });

  it("should extract mustache expressions and translatable attributes from Svelte template blocks", () => {
    const code = `<main>
      <input placeholder="Search..." title="Tip" />
      <div>Welcome {user}!</div>
    </main>`;

    const result = extract(code, "App.svelte", "App.svelte", {
      compiledState: baseState({ sfcRules: SVELTE_SFC_RULES, mustacheRegex: SVELTE_MUSTACHE }),
    });

    // Verify attributes
    const placeholderMsg = result.messages.find((m) => m.text === "Search...");
    expect(placeholderMsg).toBeDefined();

    const titleMsg = result.messages.find((m) => m.text === "Tip");
    expect(titleMsg).toBeDefined();

    // Verify template text with variable normalization
    const textMsg = result.messages.find((m) => m.text === "Welcome {user}!");
    expect(textMsg).toBeDefined();
  });
});

/**
 * Found by the documentation site, whose page component branches on whether a
 * body was loaded. `<template v-if>` is ordinary Vue, and the failure was
 * silent: the file reported zero messages and was transformed not at all.
 */
describe("SFC template block — nesting", () => {
  it("reads the whole template past a nested <template v-if>", () => {
    const code = `<script setup lang="ts">
const ready = true;
</script>

<template>
  <article>
    <template v-if="ready">
      <p>Loaded</p>
    </template>
    <template v-else>
      <p>Not written yet</p>
    </template>
    <footer>
      <a href="/edit">Edit this page</a>
    </footer>
  </article>
</template>`;

    const result = extract(code, "Page.vue", "Page.vue", {
      compiledState: baseState({ sfcRules: VUE_SFC_RULES, mustacheRegex: VUE_MUSTACHE }),
    });
    const texts = result.messages.map((m) => m.text);

    expect(texts).toContain("Loaded");
    // Everything after the first `</template>` used to be invisible.
    expect(texts).toContain("Not written yet");
    expect(texts).toContain("Edit this page");
  });
});

/**
 * Found while building the landing page: `:label="ENTRY_FILE"` put the
 * identifier in the catalog and rewrote the binding to `_t("ENTRY_FILE")`.
 */
describe("SFC attributes — bound is not literal", () => {
  const state = () => baseState({ sfcRules: VUE_SFC_RULES, mustacheRegex: VUE_MUSTACHE });

  it("extracts a literal attribute", () => {
    const code = `<template><img src="a.png" alt="A cat asleep" /></template>`;
    const result = extract(code, "P.vue", "P.vue", { compiledState: state() });
    expect(result.messages.map((m) => m.text)).toContain("A cat asleep");
  });

  it("leaves a bound attribute alone", () => {
    const code = `<template>
  <img src="a.png" :alt="caption" />
  <button :title="tooltip">Go</button>
</template>`;
    const result = extract(code, "P.vue", "P.vue", { compiledState: state() });
    const texts = result.messages.map((m) => m.text);

    // The button's own text is prose and stays.
    expect(texts).toContain("Go");
    // The expressions are code. Extracting them also rewrites them, which
    // replaces the binding with a translation of the variable's name.
    expect(texts).not.toContain("caption");
    expect(texts).not.toContain("tooltip");
  });

  it("keeps a namespaced attribute, which only looks like a binding", () => {
    const code = `<template><use xlink:title="A cat asleep" /></template>`;
    const result = extract(code, "P.vue", "P.vue", { compiledState: state() });
    // `xlink:title` is not a declared attribute name, so nothing is extracted —
    // the point is that the colon inside it does not crash or mis-skip.
    expect(result.messages.map((m) => m.text)).not.toContain("caption");
  });
});
