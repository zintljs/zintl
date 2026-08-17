import { defineConfig } from "@rsbuild/core";
import { pluginSvelte } from "@rsbuild/plugin-svelte";
import zintl from "zintljs/rsbuild";

/**
 * `create-rsbuild`'s svelte-ts starter, plus Zintl.
 *
 * The first Svelte app Zintl has on a non-Rollup host. Like the Vue one, it
 * exists so the support statement stops having to say Svelte is *untested here
 * rather than unsupported*.
 *
 * Zintl declares `enforce: "pre"`, so on Rspack its transform runs as a
 * pre-loader and sees the raw `.svelte` file before `svelte-loader` compiles it
 * — the position it holds on Vite by running before
 * `@sveltejs/vite-plugin-svelte`. There is no Rspack-specific Svelte code in
 * Zintl.
 *
 * `html.template` and the explicit `source.entry` are the two lines the template
 * does not scaffold; see `examples/rsbuild-vanilla-basic/rsbuild.config.mjs` for
 * why both are load-bearing.
 */
export default defineConfig({
  plugins: [
    /**
     * `cssHash` is pinned, and the default is the thing to know about.
     *
     * Svelte's default hashes the component's **absolute filename**, not its
     * CSS (`svelte/src/compiler/validate-options.js`). That is fine for an app
     * and wrong for anything that compares build output across machines or
     * directories: the contract suite copies each project to
     * `.tmp/runs/w<workerId>/`, so the scoped class name changed with whichever
     * worker happened to pick the job, and the `build` snapshot could never
     * settle. Hashing the CSS instead makes the output a function of the source,
     * which is what a build-output snapshot is for.
     *
     * The Vite Svelte examples never hit this because they keep their styles in
     * a shared stylesheet rather than in a component `<style>` block. This one
     * keeps the block, because `create-rsbuild`'s template has one.
     */
    pluginSvelte({
      svelteLoaderOptions: {
        compilerOptions: {
          cssHash: ({ css, hash }) => `svelte-${hash(css)}`,
        },
      },
    }),
    ...zintl({
      sourceLocale: "en",
      locales: ["en", "ar", "es", "zh"],
      similarityThreshold: 0.01,
    }),
  ],
  source: { entry: { index: "./src/index.ts" } },
  html: { template: "./index.html" },
});
