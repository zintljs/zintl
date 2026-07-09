import { reactBasic } from "./react-basic.js";
import { reactSsr } from "./react-ssr.js";
import { vueBasic } from "./vue-basic.js";
import { svelteBasic } from "./svelte-basic.js";
import { vanillaSpaBasic } from "./vanilla-spa-basic.js";
import type { ExampleManifest } from "@zintl/testing";

export const allManifests: ExampleManifest[] = [
  reactBasic,
  reactSsr,
  vueBasic,
  svelteBasic,
  vanillaSpaBasic,
];
