/**
 * The resolved facet composition of every example application, as a golden file.
 *
 * Proposal 026 §8 names **abstraction inflation** as one of the ways that work
 * goes wrong: every host difference becomes another facet capability until
 * adding a feature means touching four facets and nobody can answer "what
 * happens for a React SSR app" without running it. Facet resolution is where
 * that becomes invisible — the inputs are spread across detection, assembly and
 * a priority-ordered merge, and the output is a live object graph full of
 * functions that nothing ever prints.
 *
 * So this flattens the output to text. Any change that silently alters what
 * `react-ssr` resolves to — a facet that stops being added, a hook that changes
 * hands, a capability flag that flips — shows up as a snapshot diff instead of
 * as behaviour somebody notices later.
 *
 * It is a **description, not an assertion**. A diff here is not a failure by
 * itself; it is a question. Update the snapshot when the change was intended,
 * and read it carefully when it was not.
 *
 * The single-provider hooks are recorded as *every* facet declaring them, in
 * resolution order, rather than just the winner. Order is the whole story for
 * those: resolution is highest-priority-wins with a hard error on ties, so a
 * second name appearing under `hmrInjectionCode` is exactly the situation §10
 * wants visible before facets start self-activating and registration order
 * stops being a readable list.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vite-plus/test";
import type { ZintlFacet } from "@zintljs/compiler";
import { assembleFacets, assembleFacetsWithTrace } from "../../facets/assemble.js";
import { formatFacetTrace } from "../../facets/activate.js";
import { detectFrameworksOrFallback } from "../../facets/detect.js";
import { resolveFacets } from "../../facets/resolve.js";

function monorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("Could not locate the monorepo root");
}

const EXAMPLES_DIR = join(monorepoRoot(), "examples");

/** Every example directory that is a package, sorted for a stable snapshot. */
function exampleNames(): string[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => {
      const dir = join(EXAMPLES_DIR, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "package.json"));
    })
    .sort();
}

/** Facets declaring a given single-provider hook, in resolution order. */
function declarersOf(facets: ZintlFacet[], hook: string): string[] {
  return facets.filter((f) => typeof (f as never)[hook] === "function").map((f) => f.name);
}

function describeComposition(name: string, ssr: boolean): string {
  const root = join(EXAMPLES_DIR, name);
  const frameworks = detectFrameworksOrFallback({ root });
  const { facets, trace } = assembleFacetsWithTrace({
    frameworks,
    bundler: "vite",
    root,
    ssr,
  });
  const resolved = resolveFacets(facets);

  const lines: string[] = [];
  lines.push(`frameworks: ${frameworks.join(", ") || "(none)"}`);
  lines.push(`ssr: ${ssr}`);

  lines.push("", "facets (resolution order):");
  for (const f of resolved.facets) {
    lines.push(`  ${f.name}  [${f.concern}]  priority=${f.priority ?? 0}`);
  }

  lines.push("", "flags:");
  for (const [key, value] of Object.entries(resolved.flags).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`  ${key}: ${value}`);
  }

  lines.push("", "extraction:");
  lines.push(`  extensions: ${[...resolved.system.extensions].sort().join(", ") || "(none)"}`);
  lines.push(`  targets: ${resolved.system.extractionTargets.length}`);
  lines.push(`  sfcRules: ${resolved.system.sfcRules.length}`);
  lines.push(`  suppressionRules: ${resolved.system.suppressionRules.length}`);
  lines.push(`  mustacheRules: ${resolved.system.mustacheRules.length}`);
  lines.push(
    `  codegenFacets: ${resolved.system.codegenFacets.map((f) => f.name).join(", ") || "(none)"}`,
  );

  /**
   * Declared on the facets, using the *facet's* field names — which are not the
   * system view's. A facet contributes `wrapCode`; the merged view exposes it as
   * `ssrWrapCode`. Reading the wrong side reports "nobody provides this" for a
   * hook that is in fact provided, so the two are listed separately below.
   */
  lines.push("", "single-provider hooks — declared by (winner first):");
  for (const hook of [
    "wrapCode",
    "resolveVirtualPath",
    "dynamicImportTemplate",
    "hmrInjectionCode",
    "detectLocale",
  ]) {
    lines.push(`  ${hook}: ${declarersOf(resolved.facets, hook).join(" > ") || "(none)"}`);
  }

  lines.push("", "single-provider hooks — resolved on the system view:");
  for (const key of [
    "ssrWrapCode",
    "resolveVirtualPath",
    "dynamicImportTemplate",
    "hmrInjectionCode",
  ] as const) {
    lines.push(`  ${key}: ${typeof resolved.system[key] === "function" ? "present" : "absent"}`);
  }

  lines.push("", "ssr:");
  lines.push(`  entryTargets: ${resolved.system.ssrEntryTargets.length}`);
  lines.push(`  wrapExports: ${[...resolved.system.ssrWrapExports].sort().join(", ") || "(none)"}`);
  lines.push(`  wrapDefault: ${String(resolved.system.ssrWrapDefault)}`);

  lines.push("", "activation trace:");
  lines.push(
    ...formatFacetTrace(trace)
      .split("\n")
      .map((l) => `  ${l}`),
  );

  return lines.join("\n");
}

describe("resolved facet composition per example", () => {
  const names = exampleNames();

  it("finds the example applications", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  for (const name of names) {
    /**
     * Both variants, for every project, because SSR-ness is an input to
     * resolution rather than a property of the application.
     *
     * An SSR app resolves *two* compositions — its client build carries no SSR
     * facets, its server build does — so "the composition of react-ssr" is not a
     * well-formed question. Recording both also removes the guess this file used
     * to make (sniffing for an `entry-server.*` file), which was the one place it
     * could disagree with the plugin about what it was describing.
     */
    it(`${name} (client)`, () => {
      expect(describeComposition(name, false)).toMatchSnapshot();
    });
    it(`${name} (ssr)`, () => {
      expect(describeComposition(name, true)).toMatchSnapshot();
    });
  }
});

describe("composition invariants", () => {
  /**
   * Not a snapshot, because this one *is* an assertion.
   *
   * `assembleFacets` appends `viteFacet()` unconditionally and documents that
   * the plugin cannot function without it. Proposal 026 adds a second host, so
   * the moment that stops being true — a project resolving to a different
   * bundler facet, or none — it should fail here rather than surface as a
   * missing dynamic-import template much further downstream.
   */
  it("every example resolves exactly one bundler facet", () => {
    for (const name of exampleNames()) {
      const root = join(EXAMPLES_DIR, name);
      const resolved = resolveFacets(
        assembleFacets({
          frameworks: detectFrameworksOrFallback({ root }),
          bundler: "vite",
          root,
          ssr: false,
        }),
      );
      const bundlerFacets = resolved.facets.filter((f) => f.concern === "bundler");
      expect(
        bundlerFacets.map((f) => f.name),
        name,
      ).toEqual(["vite"]);
    }
  });

  /**
   * Guards the inflation itself rather than any one composition.
   *
   * A count is a blunt instrument, but it is the one number that moves when
   * "just one more capability" happens repeatedly, and it is cheap enough to
   * keep honest. Raise it deliberately when a facet is genuinely added.
   */
  it("no example resolves more than 12 facets", () => {
    for (const name of exampleNames()) {
      const root = join(EXAMPLES_DIR, name);
      const resolved = resolveFacets(
        assembleFacets({
          frameworks: detectFrameworksOrFallback({ root }),
          bundler: "vite",
          root,
          ssr: false,
        }),
      );
      expect(
        resolved.facets.length,
        `${name} resolved ${resolved.facets.length} facets`,
      ).toBeLessThanOrEqual(12);
    }
  });
});
