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
import { FALLBACK_FRAMEWORK, detectFrameworks } from "../../facets/detect.js";
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
