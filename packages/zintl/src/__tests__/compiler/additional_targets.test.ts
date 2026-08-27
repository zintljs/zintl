/**
 * `additionalTargets`, and the wildcard in both positions.
 *
 * `targets` on a facet *replaces* that facet's list, which is right for
 * reconfiguring one and wrong for "I want one more" — appending a single entry
 * would mean re-listing every default, and that config falls behind silently the
 * moment the defaults move. This option adds instead (proposal 033 §9.2).
 *
 * Reference: docs/spec/ZRS.md §15.6
 */
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { ZintlCompiler } from "@zintljs/compiler";
import { assembleFacets } from "../../facets/assemble.js";
import { resolveFacets } from "../../facets/resolve.js";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestDir, type TestContext } from "../helpers/fs.js";

let root: string;

async function extract(source: string, additionalTargets?: string[]) {
  const capabilities = resolveFacets(
    assembleFacets({ frameworks: [], bundler: "vite", root, isDev: true, additionalTargets }),
  );
  const c = new ZintlCompiler(
    {
      locales: ["en", "ar"],
      sourceLocale: "en",
      outputDir: "zintl",
      logLevel: "silent",
      verifyIntegrity: false,
      metadataDir: join(root, "node_modules/.zintl"),
      capabilities,
    } as never,
    root,
    true,
  );
  await c.setup();
  await c.transform(
    `import { zintl } from "zintljs";\nzintl(navigator.language);\n${source}`,
    join(root, "src/main.ts"),
    "virtual:zintl/inject",
  );
  await c.flush();
  const keys = new Set<string>();
  for (const entries of Object.values(c.messages.internalManifest)) {
    for (const e of entries) keys.add(e.text);
  }
  return [...keys].sort();
}

/** A source carrying one default-reachable string and two custom-object fields. */
const SOURCE = `
  const details = { title: "DETAILS_TITLE", note: "DETAILS_NOTE" };
  document.title = "A_DEFAULT_TARGET";
  void details;
`;

describe("additionalTargets", () => {
  beforeEach(async (context: TestContext) => {
    root = await createTestDir("zintl-additional-targets-");
    context.root = root;
    await mkdir(join(root, "src"), { recursive: true });
  });

  it("changes nothing when it is not set", async () => {
    expect(await extract(SOURCE)).toEqual(["A_DEFAULT_TARGET"]);
  });

  /**
   * The property the name promises, and the whole reason the option exists: the
   * auto-detected defaults survive alongside the custom one.
   */
  it("adds to the detected defaults rather than replacing them", async () => {
    expect(await extract(SOURCE, ["obj:details:title"])).toEqual([
      "A_DEFAULT_TARGET",
      "DETAILS_TITLE",
    ]);
  });

  /**
   * `*` has to work in both positions or it is a trap. `obj:details:*` used to
   * parse, store `"*"` as a literal field name, match nothing, and pass
   * validation — silently doing nothing, which is the defect the validation
   * pass exists to remove.
   */
  it("supports the wildcard in the field position", async () => {
    expect(await extract(SOURCE, ["obj:details:*"])).toEqual([
      "A_DEFAULT_TARGET",
      "DETAILS_NOTE",
      "DETAILS_TITLE",
    ]);
  });

  it("still supports the wildcard in the binding position", async () => {
    expect(await extract(SOURCE, ["obj:*:title"])).toEqual(["A_DEFAULT_TARGET", "DETAILS_TITLE"]);
  });

  it("supports the wildcard for a call target too", async () => {
    const found = await extract(`defineConfig({ title: "T", blurb: "B" });`, [
      "call:defineConfig:*",
    ]);
    expect(found).toEqual(["B", "T"]);
  });

  it("accepts several at once", async () => {
    const found = await extract(SOURCE, ["obj:details:note", "obj:details:title"]);
    expect(found).toEqual(["A_DEFAULT_TARGET", "DETAILS_NOTE", "DETAILS_TITLE"]);
  });

  /**
   * ZRS §15.6: *"A facet declaring a subset of what an unconditional facet
   * already declares narrows nothing — union is the merge rule."*
   *
   * Worth an assertion because the facet presets read as though they tailor
   * per framework: `svelte` and `vue` each declare a *subset* of the object
   * fields `vanilla` used to declare unconditionally, which looks like
   * narrowing and can never be. Subtraction is expressible only by replacing a
   * facet's list or excluding the facet.
   */
  it("unions across facets, so a narrower contributor removes nothing", async () => {
    const caps = resolveFacets(
      assembleFacets({
        frameworks: [],
        bundler: "vite",
        root,
        isDev: true,
        facets: [
          "builtins",
          { name: "narrow", concern: "extraction", targets: ["dom:prop:innerHTML"] } as never,
        ],
      }),
    );

    // `vanilla` declares all three; the narrower facet claims only one.
    expect([...caps.extraction.domProperties].sort()).toEqual([
      "innerHTML",
      "innerText",
      "textContent",
    ]);
  });

  /** Validation reaches this option like any other descriptor source. */
  it("refuses an invalid descriptor", async () => {
    await expect(extract(SOURCE, ["obj:details"])).rejects.toThrow(/Invalid extraction target/);
  });

  /**
   * Its own facet name, never a built-in's. Naming it `vanilla-extraction`
   * would *replace* that facet under the provenance rule — the precise opposite
   * of what this option is for.
   */
  it("appears as its own facet, so it cannot displace a built-in", async () => {
    const facets = assembleFacets({
      frameworks: [],
      bundler: "vite",
      root,
      isDev: true,
      additionalTargets: ["obj:details:*"],
    });
    const names = facets.map((f) => f.name);
    expect(names).toContain("additional-targets");
    expect(names).toContain("vanilla-extraction");
  });
});
