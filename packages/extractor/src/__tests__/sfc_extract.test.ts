import { extract } from "../parser.js";
import { describe, it, expect } from "vite-plus/test";

describe("SFC Extraction (Vue/Svelte)", () => {
  it("should extract dependencies, manual translations, and object targets from Vue script blocks with correct offsets", () => {
    const code = `<script setup lang="ts">
import { ref } from "vue";
import { t } from "zintl";
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
      targets: ["vue", "vanilla", "html"],
    });

    // 1. Check dependencies
    const depIds = result.dependencies.map((d) => d.id);
    expect(depIds).toContain("components/HelloWorld.vue");

    // 2. Check t() manual translation & line number
    const welcomeT = result.rawManualTranslations.find((m) => m.key === "Welcome back");
    expect(welcomeT).toBeDefined();
    expect(welcomeT!.start).toBe(148);
    expect(welcomeT!.line).toBe(148);
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
import { t } from "zintl";
import Nested from "./Nested.svelte";
const message = t("Welcome Svelte");
</script>

<main>
  <h1>Hello World</h1>
</main>`;

    const result = extract(code, "App.svelte", "App.svelte", {
      targets: ["svelte", "vanilla", "html"],
    });

    // 1. Check dependencies
    const depIds = result.dependencies.map((d) => d.id);
    expect(depIds).toContain("Nested.svelte");

    // 2. Check manual translations
    const welcomeT = result.rawManualTranslations.find((m) => m.key === "Welcome Svelte");
    expect(welcomeT).toBeDefined();
    expect(welcomeT!.start).toBe(90);
    expect(welcomeT!.line).toBe(90);
    expect(code.substring(welcomeT!.start, welcomeT!.end)).toBe('t("Welcome Svelte")');
  });
});
