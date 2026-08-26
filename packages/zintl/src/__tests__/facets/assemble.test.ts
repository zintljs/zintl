/**
 * Facet assembly and self-activation.
 *
 * The framework mapping and its exceptions used to live in `autoFacets` as a
 * switch and a pair of `if (!isNext)` guards. Under the inversion each facet
 * declares its own condition, so what is under test here is that the *same*
 * decisions still come out — plus the thing the old shape could not offer at
 * all, which is a trace saying why.
 */
import { describe, it, expect } from "vite-plus/test";
import {
  assembleFacets,
  assembleFacetsWithTrace,
  excludeFacet,
  flattenFacets,
  BUILTINS,
} from "../../facets/assemble.js";
import { assetsFacet } from "@zintljs/compiler/facets";
import { detectFrameworks } from "../../facets/detect.js";
import { createTestDir } from "../helpers/fs.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZintlFacet } from "@zintljs/compiler";
import type { FacetsInput } from "../../types.js";

const names = (facets: ZintlFacet[]) => facets.map((f) => f.name);

describe("flattenFacets", () => {
  const builtins: ZintlFacet[] = [{ name: "builtin-a", concern: "runtime" } as ZintlFacet];

  it("expands the builtins sentinel", () => {
    expect(names(flattenFacets([BUILTINS], builtins).facets)).toEqual(["builtin-a"]);
  });

  it("unwraps thunks", () => {
    const f = { name: "thunked", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets([() => f], builtins).facets)).toEqual(["thunked"]);
  });

  it("flattens nested arrays", () => {
    const a = { name: "a", concern: "runtime" } as ZintlFacet;
    const b = { name: "b", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets([[a, [b]]], builtins).facets)).toEqual(["a", "b"]);
  });

  it("drops falsy entries rather than throwing", () => {
    expect(flattenFacets([undefined as never, null as never], builtins).facets).toEqual([]);
  });

  it("keeps user facets alongside the expanded builtin set", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets([BUILTINS, mine], builtins).facets)).toEqual(["builtin-a", "mine"]);
  });

  /**
   * Naming a built-in replaces it, whichever side of `"builtins"` it is on.
   *
   * This used to be a coin flip decided by sort stability: same name, same
   * priority, and `resolveFacets` keeping whichever came first. Listing
   * `"builtins"` first — which is what the docs show — silently discarded the
   * user's configured facet, and nothing said so.
   */
  it("replaces a built-in with the user's facet of the same name", () => {
    const mine = { name: "builtin-a", concern: "runtime", priority: 0 } as ZintlFacet;

    for (const inputs of [
      [BUILTINS, mine],
      [mine, BUILTINS],
    ] as FacetsInput[][]) {
      const result = flattenFacets(inputs, builtins);
      expect(result.facets).toEqual([mine]);
      expect(result.facets[0]).toBe(mine);
      expect(Array.from(result.overridden)).toEqual(["builtin-a"]);
    }
  });

  it("reports nothing overridden when the names do not collide", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(Array.from(flattenFacets([BUILTINS, mine], builtins).overridden)).toEqual([]);
  });

  /**
   * The bundler facets are always candidates, so they are ours for this purpose
   * too — a project shipping its own `vite` facet means to replace ours.
   */
  it("replaces an always-candidate facet the user names", () => {
    const ours = { name: "vite", concern: "bundler" } as ZintlFacet;
    const mine = { name: "vite", concern: "bundler" } as ZintlFacet;

    const result = flattenFacets([BUILTINS, mine], builtins, [ours]);
    expect(result.facets.filter((f) => f.name === "vite")).toEqual([mine]);
    expect(result.overridden.has("vite")).toBe(true);
  });

  it("keeps the surviving facets in the order they were listed", () => {
    const a = { name: "a", concern: "runtime" } as ZintlFacet;
    const c = { name: "c", concern: "runtime" } as ZintlFacet;
    const mineB = { name: "builtin-a", concern: "runtime" } as ZintlFacet;

    expect(names(flattenFacets([a, BUILTINS, mineB, c], builtins).facets)).toEqual([
      "a",
      "builtin-a",
      "c",
    ]);
  });
});

describe("self-activation", () => {
  const vite = { bundler: "vite" };

  it("activates a framework facet only when that framework was detected", () => {
    expect(names(assembleFacets({ ...vite, frameworks: ["vue"] }))).toContain("vue-extraction");
    expect(names(assembleFacets({ ...vite, frameworks: ["vue"] }))).not.toContain(
      "react-extraction",
    );
    expect(names(assembleFacets({ ...vite, frameworks: ["svelte"] }))).toContain(
      "svelte-extraction",
    );
  });

  it("keeps unconditional facets on for every project", () => {
    const n = names(assembleFacets({ ...vite, frameworks: ["react"] }));
    expect(n).toContain("vanilla-extraction");
    expect(n).toContain("html-extraction");
    expect(n).toContain("system-static-assets");
  });

  it("activates the generic ssr facets only for SSR builds", () => {
    expect(names(assembleFacets({ ...vite, frameworks: ["react"], ssr: true }))).toContain(
      "ssr-wrapping",
    );
    expect(names(assembleFacets({ ...vite, frameworks: ["react"], ssr: false }))).not.toContain(
      "ssr-wrapping",
    );
  });

  it("explains itself, positively and negatively", () => {
    const { trace } = assembleFacetsWithTrace({ ...vite, frameworks: ["vue"] });
    const vueEntry = trace.find((e) => e.name === "vue-extraction");
    const reactEntry = trace.find((e) => e.name === "react-extraction");

    expect(vueEntry).toMatchObject({ active: true });
    expect(vueEntry!.reason).toContain("framework=vue");

    // The negative entry is the one someone debugging "why is React off?" needs,
    // and it has to name the detected set rather than just saying no.
    expect(reactEntry).toMatchObject({ active: false });
    expect(reactEntry!.reason).toContain("detected: vue");
  });
});

describe("supersession", () => {
  const vite = { bundler: "vite" };

  /**
   * These three were `if (!isNext)` in `autoFacets`, with the reason in a
   * comment. They are now declarations on the Next facets, so the behaviour is
   * unchanged and the *reason* is finally something the system can act on.
   */
  it("lets Next.js replace the generic ssr wrapper it would collide with", () => {
    const n = names(assembleFacets({ ...vite, frameworks: ["nextjs"], ssr: true }));
    expect(n).toContain("nextjs-ssr-wrapping");
    expect(n).not.toContain("ssr-wrapping");
  });

  it("lets Next.js replace client-spa", () => {
    expect(names(assembleFacets({ ...vite, frameworks: ["react"] }))).toContain("client-spa");
    expect(names(assembleFacets({ ...vite, frameworks: ["nextjs"] }))).not.toContain("client-spa");
  });

  it("records who displaced whom", () => {
    const { trace } = assembleFacetsWithTrace({ ...vite, frameworks: ["nextjs"], ssr: true });
    expect(trace.find((e) => e.name === "ssr-wrapping")?.reason).toBe(
      "superseded by nextjs-ssr-wrapping",
    );
  });

  it("supersedes nothing when the superseding facet is itself inactive", () => {
    // No Next.js detected, so its facets never activate and must not displace
    // the generic ones they would otherwise replace.
    expect(names(assembleFacets({ ...vite, frameworks: ["react"], ssr: true }))).toContain(
      "ssr-wrapping",
    );
  });

  /**
   * Reconfiguring one built-in is the reason `facets` accepts a list at all,
   * and `["builtins", assetsFacet({ … })]` is the shape the docs show for it.
   * The user's copy has to be the one that survives — and the trace has to say
   * the other one went, because being discarded in silence was the defect.
   */
  it("lets a project replace a built-in by naming it", () => {
    const mine = {
      name: "system-static-assets",
      concern: "content",
      contentFacet: { name: "system-static-assets", extensions: [".mdx"] },
    } as unknown as ZintlFacet;

    const { facets, trace } = assembleFacetsWithTrace({
      ...vite,
      frameworks: ["react"],
      facets: [BUILTINS, mine],
    });

    expect(facets.filter((f) => f.name === "system-static-assets")).toEqual([mine]);
    expect(trace.find((e) => e.name === "system-static-assets (built-in)")?.reason).toBe(
      'replaced by the "system-static-assets" facet you passed',
    );
  });

  /**
   * Order is not load-bearing — the property `activate.ts` states in its header
   * and the one the old name-dedupe quietly broke.
   */
  it("replaces the built-in whichever side of the sentinel it is listed on", () => {
    const mine = { name: "system-static-assets", concern: "content" } as ZintlFacet;

    for (const facets of [
      [BUILTINS, mine],
      [mine, BUILTINS],
    ] as FacetsInput[][]) {
      const resolved = assembleFacets({ ...vite, frameworks: ["react"], facets });
      expect(resolved.filter((f) => f.name === "system-static-assets")).toEqual([mine]);
    }
  });
});

describe("bundler facets", () => {
  it("activates the vite facet on a vite host", () => {
    expect(names(assembleFacets({ bundler: "vite", frameworks: ["react"] }))).toContain("vite");
  });

  it("does not hand the vite facet to another host", () => {
    expect(names(assembleFacets({ bundler: "rspack", frameworks: ["react"] }))).not.toContain(
      "vite",
    );
  });

  it("keeps the bundler facet a candidate even for an explicit user list", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(names(assembleFacets({ bundler: "vite", frameworks: [], facets: [mine] }))).toEqual([
      "mine",
      "vite",
    ]);
  });
});

describe("the builtins sentinel", () => {
  it("defaults to the built-in set", () => {
    expect(names(assembleFacets({ bundler: "vite", frameworks: ["vue"] }))).toContain(
      "vue-extraction",
    );
  });

  /**
   * `"auto"` was removed rather than aliased. Zintl is pre-1.0 with no users to
   * migrate, and a silent second spelling is a migration nobody ever finishes —
   * so the old name is a type error, not a quiet synonym.
   */
  it('rejects the removed "auto" spelling at the type level', () => {
    // @ts-expect-error - "auto" is no longer a FacetsInput
    const usesRemovedSentinel: FacetsInput[] = ["auto"];
    expect(usesRemovedSentinel).toEqual(["auto"]);
  });

  it("omitting it leaves only the user's facets and the host integration", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(names(assembleFacets({ bundler: "vite", frameworks: ["vue"], facets: [mine] }))).toEqual(
      ["mine", "vite"],
    );
  });

  it("drops a single builtin by name without listing the rest", () => {
    const n = names(
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, excludeFacet("client-spa")],
      }),
    );
    expect(n).not.toContain("client-spa");
    expect(n).toContain("react-extraction");
  });
});

/**
 * An option that configures a facet the project removed is refused.
 *
 * `assetsTarget` and `virtualAssets` reach the *built-in* assets facet, and
 * replacing or excluding that facet used to strand them: accepted, validated,
 * and configuring nothing, so the files they named were quietly not localized.
 * Proposal 034 §1.6 and §8.
 *
 * The negative cases carry as much weight as the positive one. This guard fires
 * on a combination that is easy to reach by accident — a shared plugin config
 * plus a project-level facet override — so a false positive would refuse builds
 * that are entirely correct.
 */
describe("options that configure a built-in facet", () => {
  const assets = () => assetsFacet({ targets: ["mdx"] });

  it("refuses `assetsTarget` when the assets facet is replaced", () => {
    expect(() =>
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, assets()],
        assetsTarget: ["rst"],
      }),
    ).toThrow(/`assetsTarget` configures the built-in "system-static-assets" facet/);
  });

  it("refuses `assetsTarget` when the assets facet is excluded", () => {
    expect(() =>
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, excludeFacet("system-static-assets")],
        assetsTarget: ["rst"],
      }),
    ).toThrow(/excluded/);
  });

  it("names every stranded option, not just the first", () => {
    let message = "";
    try {
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, assets()],
        assetsTarget: ["rst"],
        virtualAssets: true,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("`assetsTarget`");
    expect(message).toContain("`virtualAssets`");
    // And the way out, which is the whole reason this is an error.
    expect(message).toContain("assetsFacet({ targets: [...] })");
  });

  it("allows the options when the built-in facet is still in the build", () => {
    expect(() =>
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS],
        assetsTarget: ["rst"],
        virtualAssets: true,
      }),
    ).not.toThrow();
  });

  it("allows replacing the facet when no option was configuring it", () => {
    expect(() =>
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, assets()],
      }),
    ).not.toThrow();
  });

  /**
   * `virtualAssets` is resolved against a default before it arrives, so "not
   * set" and "set to false" are the same value. Treating that as a signal would
   * refuse every project that replaces the assets facet — and `false` is the
   * facet's own default, so nothing is lost by ignoring it.
   */
  it("does not treat a defaulted `virtualAssets: false` as configuration", () => {
    expect(() =>
      assembleFacets({
        bundler: "vite",
        frameworks: ["react"],
        facets: [BUILTINS, assets()],
        virtualAssets: false,
      }),
    ).not.toThrow();
  });
});

describe("detectFrameworks", () => {
  it("reads frameworks off bundler plugin names", () => {
    expect(detectFrameworks({ pluginNames: ["vite:react-jsx"] })).toEqual(["react"]);
    expect(detectFrameworks({ pluginNames: ["vite-plugin-svelte"] })).toEqual(["svelte"]);
  });

  /**
   * Empty is the answer, not a prompt for a guess.
   *
   * This used to also assert `FALLBACK_FRAMEWORK === "react"`, which is the
   * behaviour ledger L-034 removed: guessing React for a project that never
   * mentions it gave every framework-less app React extraction and codegen, and
   * made "does this app have client reactivity" unanswerable.
   */
  it("returns empty when nothing matches", () => {
    expect(detectFrameworks({ pluginNames: ["some-unrelated-plugin"] })).toEqual([]);
  });

  it("reads the JSX dialects that are not React", () => {
    expect(detectFrameworks({ pluginNames: ["@preact/preset-vite"] })).toEqual(["preact"]);
    expect(detectFrameworks({ pluginNames: ["vite-plugin-solid"] })).toEqual(["solid"]);
    expect(detectFrameworks({ pluginNames: ["rsbuild:solid"] })).toEqual(["solid"]);
  });

  /**
   * A Preact project is not a React project that also uses Preact.
   *
   * `@preact/preset-vite` aliases `react` and `react-dom` to `preact/compat`, so
   * both names are genuinely present — in the dependency graph and, depending on
   * the plugin, in the plugin list. Resolving as both is not a cosmetic problem:
   * `preact-codegen` and `react-codegen` each claim `.tsx` at priority 100, and
   * `mergeCodegenFacets` throws on exactly that.
   */
  it("prefers Preact over React when a project has both", () => {
    expect(detectFrameworks({ pluginNames: ["@preact/preset-vite", "vite:react-babel"] })).toEqual([
      "preact",
    ]);
  });

  /**
   * Solid is matched on separator boundaries, not as a substring.
   *
   * `splitVendorChunk` contains "solid" the way `spl` + `it` does — and a
   * substring test would have activated Solid's facet, including its reactive
   * bridge, for a project that never mentioned the framework. Lit gets no
   * plugin-name rule at all for the same reason: it has no plugin on either
   * host, so every match would have been a false one.
   */
  it("does not read a framework out of an unrelated plugin name", () => {
    expect(detectFrameworks({ pluginNames: ["splitVendorChunk"] })).toEqual([]);
    expect(detectFrameworks({ pluginNames: ["vite:build-import-analysis"] })).toEqual([]);
  });

  /**
   * `nextjs` means vinext, and only vinext.
   *
   * The Next.js facets wrap `virtual:vinext-*` entries, so they can only serve a
   * Next.js app running on Vite through vinext. Detecting the framework from a
   * bare `next` dependency claimed apps the facets cannot help — and did real
   * damage while claiming them, because `nextjs-runtime` supersedes
   * `client-spa`. A Vite SPA in a monorepo that merely had `next` in its
   * manifest lost client locale sync to a facet set that then bound to nothing.
   */
  it("detects nextjs from vinext, and not from a bare next dependency", async () => {
    const root = await createTestDir("zintl-detect-nextjs-");

    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
    );
    expect(detectFrameworks({ root })).toEqual(["react"]);

    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
        devDependencies: { vinext: "^0.1.0" },
      }),
    );
    expect(detectFrameworks({ root })).toEqual(["react", "nextjs"]);
  });

  /**
   * The plugin-name rule is separator-bounded for the same reason Solid's is.
   *
   * `includes("next")` matched any plugin with those four letters anywhere in
   * its name, which is a wide net for a facet set that supersedes two others.
   */
  it("matches vinext on separator boundaries, not as a substring", () => {
    expect(detectFrameworks({ pluginNames: ["vinext"] })).toEqual(["nextjs"]);
    expect(detectFrameworks({ pluginNames: ["vinext:rsc"] })).toEqual(["nextjs"]);
    expect(detectFrameworks({ pluginNames: ["vite-plugin-nextgen-assets"] })).toEqual([]);
    expect(detectFrameworks({ pluginNames: ["rollup-plugin-context"] })).toEqual([]);
  });
});
