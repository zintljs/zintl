/**
 * Axiom D4 — one subject, one owner (`docs/spec/ZDB.md` §7).
 *
 * Every fan-out across the facet set must declare its composition. These cover
 * the two that were outright defects: a `union` that silently let the last
 * contributor win a key collision, and a `chain` that returned on the first
 * implementer and made every later one unreachable.
 */
import { describe, it, expect, vi } from "vite-plus/test";
import { ZintlCompiler } from "../../index.js";
import { emptyCapabilities } from "../helpers/capabilities.js";
import type { ContentFacet, ZintlFacet } from "../../types/capabilities.js";
import { viteFacet, svelteRuntimeFacet } from "../../facet/index.js";

/** `ZintlFacet` is a union; the injection hook lives on the bundler member. */
const inject = (...args: [string, number, boolean, boolean]) =>
  (viteFacet() as Extract<ZintlFacet, { concern: "bundler" }>).hmrInjectionCode!(...args);

function compilerWith(contentFacets: Partial<ContentFacet>[]) {
  const capabilities = emptyCapabilities({
    contentFacets: contentFacets.map((f) => ({ match: () => false, ...f })) as ContentFacet[],
  });
  return new ZintlCompiler(
    { capabilities, locales: ["en", "ar"], sourceLocale: "en" } as never,
    "/tmp/zintl-facet-test",
    true,
  );
}

describe("getTranslations — union, collisions are conflicts", () => {
  it("merges keys from every facet", async () => {
    const compiler = compilerWith([
      { name: "a", getTranslations: () => ({ hello: "Hello" }) },
      { name: "b", getTranslations: () => ({ bye: "Bye" }) },
    ]);

    const merged = await (
      compiler as unknown as {
        mergeFacetTranslations: (l: string, c: unknown) => Promise<Record<string, string>>;
      }
    ).mergeFacetTranslations("en", {});

    expect(merged).toEqual({ hello: "Hello", bye: "Bye" });
  });

  it("accepts two facets agreeing about a key", () => {
    // Agreement is not a conflict. Only a disagreement is.
    const compiler = compilerWith([
      { name: "a", getTranslations: () => ({ hello: "Hello" }) },
      { name: "b", getTranslations: () => ({ hello: "Hello" }) },
    ]);

    return expect(
      (
        compiler as unknown as {
          mergeFacetTranslations: (l: string, c: unknown) => Promise<Record<string, string>>;
        }
      ).mergeFacetTranslations("en", {}),
    ).resolves.toEqual({ hello: "Hello" });
  });

  it("hard-errors when two facets claim one key with different values", async () => {
    /**
     * This was `Object.assign` in a loop: the last facet in iteration order won
     * and the other's content vanished, with the outcome decided by
     * registration order rather than by anything anyone chose.
     */
    const compiler = compilerWith([
      { name: "first", getTranslations: () => ({ hello: "Hello" }) },
      { name: "second", getTranslations: () => ({ hello: "Hi" }) },
    ]);

    await expect(
      (
        compiler as unknown as {
          mergeFacetTranslations: (l: string, c: unknown) => Promise<Record<string, string>>;
        }
      ).mergeFacetTranslations("en", {}),
    ).rejects.toThrow(/both provide the key/i);
  });
});

describe("transformHtml — chain, every facet participates", () => {
  it("passes each facet's output to the next", async () => {
    // The loop used to `return` on the first implementer, so a second facet was
    // registered, never called, and had no way to find out.
    const compiler = compilerWith([
      { name: "a", transformHtml: (html: string) => `${html}<!--a-->` },
      { name: "b", transformHtml: (html: string) => `${html}<!--b-->` },
    ]);

    expect(await compiler.transformHtml("<html>", "index.html")).toBe("<html><!--a--><!--b-->");
  });

  it("returns the input untouched when no facet implements it", async () => {
    const compiler = compilerWith([{ name: "a" }]);
    expect(await compiler.transformHtml("<html>", "index.html")).toBe("<html>");
  });
});

describe("rtlLocales — union, not a chain", () => {
  /**
   * Deliberately a different composition from `transformHtml` above, and the
   * contrast is the point: a facet rewriting HTML consumes the previous one's
   * output, but a facet reporting that Arabic is right-to-left states an
   * independent fact that no later facet gets to retract.
   */
  it("merges every facet's answer", async () => {
    const compiler = compilerWith([
      { name: "a", rtlLocales: () => ["ar"] },
      { name: "b", rtlLocales: () => ["he"] },
    ]);

    expect(await compiler.getRtlLocales()).toEqual(["ar", "he"]);
  });

  it("de-duplicates and sorts, so the substituted literal is stable", async () => {
    // Unstable ordering here is snapshot churn in every built bundle, since
    // this array is inlined into generated runtime source.
    const compiler = compilerWith([
      { name: "a", rtlLocales: () => ["he", "ar"] },
      { name: "b", rtlLocales: () => ["ar"] },
    ]);

    expect(await compiler.getRtlLocales()).toEqual(["ar", "he"]);
  });

  it("returns empty when no facet implements it", async () => {
    // Empty must stay distinguishable from "nobody asked": the store reads it
    // as "this project never spoke about direction" and leaves `dir` alone.
    const compiler = compilerWith([{ name: "a" }]);
    expect(await compiler.getRtlLocales()).toEqual([]);
  });

  it("awaits a facet that answers asynchronously", async () => {
    const compiler = compilerWith([{ name: "a", rtlLocales: async () => Promise.resolve(["fa"]) }]);

    expect(await compiler.getRtlLocales()).toEqual(["fa"]);
  });
});

describe("facet lifecycle — union, failures isolated and named", () => {
  it("runs every facet even when one throws, and names the one that did", async () => {
    /**
     * A bare sequential `await` loop took the whole fan-out down with the first
     * failure: every facet after it in registration order silently never ran,
     * and the only evidence was whichever error happened to surface.
     */
    const later = vi.fn();
    const compiler = compilerWith([
      {
        name: "broken",
        setup: () => {
          throw new Error("facet exploded");
        },
      },
      { name: "healthy", setup: later },
    ]);
    vi.spyOn(
      (compiler as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
      "error",
    ).mockImplementation(() => {});

    await compiler.setup();

    expect(later).toHaveBeenCalled();
    expect(compiler.bus.history("build/pipeline")).toContainEqual(
      expect.objectContaining({ subject: "setup:broken", outcome: "failed" }),
    );
  });
});

describe("entryReexecutionSafe — the framework decides, pessimistically", () => {
  it("emits a self-accept when re-running the entry is safe", () => {
    // Vanilla assigns innerHTML, which replaces. Self-accepting keeps hot
    // updates hot — and `memory-leak` performs twenty sequential entry edits,
    // so the alternative is twenty full page reloads.
    const code = inject("src/main", 0, true, true);
    expect(code).toContain("import.meta.hot.accept(");
    expect(code).not.toContain("invalidate()");
  });

  it("hands the update back when re-running the entry is not safe", () => {
    // Svelte's mount() appends and React's createRoot() throws. Accepting and
    // immediately invalidating bubbles to a reload, which is what would have
    // happened had the file never claimed to accept.
    const code = inject("src/main", 0, true, false);
    expect(code).toContain("import.meta.hot.invalidate()");
  });

  it("injects nothing for a file with no anchor either way", () => {
    expect(inject("src/util", 0, false, true)).toBe("");
    expect(inject("src/util", 0, false, false)).toBe("");
  });

  it("declares the framework whose mount cannot be replayed", () => {
    /**
     * Asserted on the facets rather than on a resolved project, because this is
     * the claim itself: a framework says whether re-running its entry is safe,
     * and the bundler's injection hook has no way to know.
     */
    expect(svelteRuntimeFacet()).toMatchObject({ entryReexecutionSafe: false });
  });
});
