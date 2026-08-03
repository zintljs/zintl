import { reactBasic } from "./react-basic.js";
import { reactSsr } from "./react-ssr.js";
import { vueBasic } from "./vue-basic.js";
import { vueSsr } from "./vue-ssr.js";
import { svelteBasic } from "./svelte-basic.js";
import { svelteSsr } from "./svelte-ssr.js";
import { vanillaSpaBasic } from "./vanilla-spa-basic.js";
import { vanillaSsr } from "./vanilla-ssr.js";
import { assetsBasic } from "../fixtures/assets-basic.js";
import type { ProjectManifest } from "@zintljs/testing";

/**
 * Every project contracts can run against — real example applications and
 * inline fixtures alike. Contracts are matched by capability, so a manifest's
 * origin is irrelevant here.
 *
 * Adding a manifest is not free: cost is roughly (examples × matching
 * contracts), and each one also brings a per-worker copy and a pooled dev
 * server. Two things keep that in hand — claim only capabilities that are
 * actually true, since an inert claim costs nothing at runtime but misreports
 * what is covered; and prefer `fixtureSource` when the question is "does this
 * one feature work", rather than adding a whole example to ask it.
 */
export const allManifests: ProjectManifest[] = [
  reactBasic,
  reactSsr,
  vueBasic,
  vueSsr,
  svelteBasic,
  svelteSsr,
  vanillaSpaBasic,
  vanillaSsr,
  assetsBasic,
];
