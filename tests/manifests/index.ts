import { reactBasic } from "./react-basic.js";
import { reactSsr } from "./react-ssr.js";
import { vueBasic } from "./vue-basic.js";
import { svelteBasic } from "./svelte-basic.js";
import { vanillaSpaBasic } from "./vanilla-spa-basic.js";
import { assetsBasic } from "../fixtures/assets-basic.js";
import type { ProjectManifest } from "@zintljs/testing";

/**
 * Every project contracts can run against — real example applications and
 * inline fixtures alike. Contracts are matched by capability, so a manifest's
 * origin is irrelevant here.
 */
export const allManifests: ProjectManifest[] = [
  reactBasic,
  reactSsr,
  vueBasic,
  svelteBasic,
  vanillaSpaBasic,
  assetsBasic,
];
