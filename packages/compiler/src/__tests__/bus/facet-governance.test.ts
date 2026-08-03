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
import type { ContentFacet } from "../../types/capabilities.js";

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
