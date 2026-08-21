import {
  clickLocaleBar,
  copiedExampleSource,
  type ProjectManifest,
  type ZintlPluginOptions,
} from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

export const vueBasic: ProjectManifest = {
  name: "vue-basic",
  source: copiedExampleSource("vue-basic"),
  zintlOptions,
  capabilities: [
    "spa",
    "hmr",
    "hmr-structural",
    "hmr-warm",
    "locale-switch",
    "rtl",
    "boundary-graph",
    "hmr-stress",
    "locale-switch-stress",
    "chaos",
    "chaos-boundary",
    "memory",
    "performance",
    "transform",
    "build",
    "graph",
  ],
  adapter: {
    /**
     * A **statement**, not a comment — Vue is the dialect where the difference
     * matters.
     *
     * `@vitejs/plugin-vue` compares a block's *compiled* output to decide
     * whether an update is needed, and comments do not survive compilation. A
     * `// zintl perf baseline` line therefore changed the file and produced no
     * update packet at all: measured, 10 failures in 10, while the same comment
     * worked on React, Svelte and vanilla. `void 0;` compiles to something,
     * repeats safely however many times it is inserted, and mentions no string
     * for the extractor to find.
     */
    perfNoopEdit: {
      file: "src/components/HelloWorld.vue",
      anchorOn: `<script setup lang="ts">`,
      insert: `\nvoid 0;`,
    },
    /**
     * The two edits `hmr-growth` makes, on opposite sides of ZHMR's structural line.
     *
     * The sink goes where the markup is — `HelloWorld.vue`, not `App.vue` — and the anchor
     * where the macro is already imported. Vue's first run at ZHMR §4.1③/§4.2.
     */
    addSink: {
      file: "src/components/HelloWorld.vue",
      anchorOn: "<h1>Get started</h1>",
      insert: `\n      <p id="new-sink">A brand new sentence</p>`,
      expectText: "A brand new sentence",
      selector: "#new-sink",
    },
    addAnchor: {
      file: "src/main.ts",
      anchorOn: `import { zintl } from "zintljs/macro";`,
      insert: [
        ``,
        ``,
        `// A second, independent trust anchor — nested in a function, so it is a`,
        `// new boundary rather than a second entry point.`,
        `async function extraAnchor() {`,
        `  // A *variable* locale, deliberately: a literal is a build-time fact the`,
        `  // compiler bakes, and baking the source locale emits no catalog chunk at`,
        `  // all — so the graph might not grow, and the contract would assert on a`,
        `  // structural change that never happened.`,
        `  const extraLang = new URLSearchParams(window.location.search).get("x") || "ar";`,
        `  await zintl(extraLang);`,
        `  document.title = "Extra anchor added";`,
        `}`,
      ].join("\n"),
    },
    /**
     * Which file `chaos-boundary` renames, and who imports it.
     *
     * The contract used to carry a `switch (exampleName)` and throw for any
     * project it did not recognise — so claiming `chaos` meant editing the
     * contract, and a capability that was really contract-limited got
     * recorded as host-limited.
     */
    renameBoundary: {
      fromPath: "src/components/HelloWorld.vue",
      toPath: "src/components/Hello.vue",
      parentPath: "src/App.vue",
      importSearch: "./components/HelloWorld.vue",
      importReplace: "./components/Hello.vue",
    },
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/components/HelloWorld.vue",
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/`);
    },
    switchLocale: (lab, locale) => clickLocaleBar(lab, locale),
  },
};
