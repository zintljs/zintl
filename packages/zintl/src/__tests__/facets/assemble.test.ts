/**
 * Facet assembly — the decisions that used to be buried in `configResolved`.
 *
 * None of this was tested before: not the `"auto"` expansion, not the framework
 * mapping, and not the fact that `viteFacet()` is injected unconditionally.
 */
import { describe, it, expect } from "vite-plus/test";
import { assembleFacets, autoFacets, flattenFacets } from "../../facets/assemble.js";
import { FALLBACK_FRAMEWORK, detectFrameworks } from "../../facets/detect.js";
import type { ZintlFacet } from "@zintl/compiler";

const names = (facets: ZintlFacet[]) => facets.map((f) => f.name);

describe("flattenFacets", () => {
  const auto: ZintlFacet[] = [{ name: "auto-a", concern: "runtime" } as ZintlFacet];

  it('expands the "auto" sentinel', () => {
    expect(names(flattenFacets(["auto"], auto))).toEqual(["auto-a"]);
  });

  it("unwraps thunks", () => {
    const f = { name: "thunked", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets([() => f], auto))).toEqual(["thunked"]);
  });

  it("flattens nested arrays", () => {
    const a = { name: "a", concern: "runtime" } as ZintlFacet;
    const b = { name: "b", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets([[a, [b]]], auto))).toEqual(["a", "b"]);
  });

  it("drops falsy entries rather than throwing", () => {
    expect(flattenFacets([undefined as never, null as never], auto)).toEqual([]);
  });

  it("keeps user facets alongside the expanded auto set", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(names(flattenFacets(["auto", mine], auto))).toEqual(["auto-a", "mine"]);
  });
});

describe("autoFacets", () => {
  it("maps each framework to its preset", () => {
    expect(names(autoFacets({ frameworks: ["vue"] }))).toContain("vue-extraction");
    expect(names(autoFacets({ frameworks: ["svelte"] }))).toContain("svelte-extraction");
    expect(names(autoFacets({ frameworks: ["react"] }))).toContain("react-extraction");
  });

  it("always includes the vanilla, html and assets baselines", () => {
    const n = names(autoFacets({ frameworks: ["react"] }));
    expect(n).toContain("vanilla-extraction");
    expect(n).toContain("html-extraction");
    expect(n).toContain("system-static-assets");
  });

  it("adds client-spa for non-Next projects and omits it for Next", () => {
    expect(names(autoFacets({ frameworks: ["react"] }))).toContain("client-spa");
    expect(names(autoFacets({ frameworks: ["nextjs"] }))).not.toContain("client-spa");
  });

  it("adds the generic ssr facet only for non-Next SSR builds", () => {
    expect(names(autoFacets({ frameworks: ["react"], ssr: true }))).toContain("ssr-wrapping");
    expect(names(autoFacets({ frameworks: ["react"], ssr: false }))).not.toContain("ssr-wrapping");
  });

  it("does not pair the generic ssr facet with Next, which brings its own", () => {
    // Both provide ssr.wrapCode at priority 100 under different names, so
    // resolution would throw a facet conflict if they were combined.
    const n = names(autoFacets({ frameworks: ["nextjs"], ssr: true }));
    expect(n).toContain("nextjs-ssr-wrapping");
    expect(n).not.toContain("ssr-wrapping");
  });
});

describe("assembleFacets", () => {
  it("always injects the vite bundler facet", () => {
    expect(names(assembleFacets({ frameworks: ["react"] }))).toContain("vite");
  });

  it("injects vite even when the user supplies an explicit facet list", () => {
    const mine = { name: "mine", concern: "runtime" } as ZintlFacet;
    expect(names(assembleFacets({ frameworks: [], facets: [mine] }))).toEqual(["mine", "vite"]);
  });

  it('defaults to "auto" when the user names no facets', () => {
    expect(names(assembleFacets({ frameworks: ["vue"] }))).toContain("vue-extraction");
  });
});

describe("detectFrameworks", () => {
  it("reads frameworks off bundler plugin names", () => {
    expect(detectFrameworks({ pluginNames: ["vite:react-jsx"] })).toEqual(["react"]);
    expect(detectFrameworks({ pluginNames: ["vite-plugin-svelte"] })).toEqual(["svelte"]);
  });

  it("returns empty when nothing matches, leaving the guess to the caller", () => {
    expect(detectFrameworks({ pluginNames: ["some-unrelated-plugin"] })).toEqual([]);
    expect(FALLBACK_FRAMEWORK).toBe("react");
  });
});
