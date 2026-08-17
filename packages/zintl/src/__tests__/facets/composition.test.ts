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
import { detectFrameworks } from "../../facets/detect.js";
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

/**
 * Which bundler hosts this example, derived from the config file it ships.
 *
 * Not a constant, since `examples/` stopped being Vite-only. A golden file that
 * described `rsbuild-vanilla-basic` as resolving `viteFacet` — and an invariant that
 * asserted it — would be a guardrail vouching for a world the app does not live
 * in, which is worse than no guardrail: the composition it captured would be one
 * no build ever produces.
 *
 * `facet-composition.contract.spec.ts` makes the same distinction from the other
 * side, off `manifest.driver`. This derives it from disk because these tests
 * enumerate `examples/` directly and have no manifest to ask.
 */
function bundlerFor(name: string): string {
  return existsSync(join(EXAMPLES_DIR, name, "rsbuild.config.mjs")) ? "rspack" : "vite";
}

/** Facets declaring a given single-provider hook, in resolution order. */
function declarersOf(facets: ZintlFacet[], hook: string): string[] {
  return facets.filter((f) => typeof (f as never)[hook] === "function").map((f) => f.name);
}

function describeComposition(name: string, ssr: boolean): string {
  const root = join(EXAMPLES_DIR, name);
  const frameworks = detectFrameworks({ root });
  const bundler = bundlerFor(name);
  const { facets, trace } = assembleFacetsWithTrace({
    frameworks,
    bundler,
    root,
    ssr,
  });
  const resolved = resolveFacets(facets);

  const lines: string[] = [];
  lines.push(`frameworks: ${frameworks.join(", ") || "(none)"}`);
  lines.push(`bundler: ${bundler}`);
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
  /**
   * These two lists are hand-maintained, which is the guard's one weak point:
   * a hook missing from them is a facet-surface change the golden files cannot
   * see, which defeats the reason the files exist. `hmrSelfAcceptCode` sat
   * unlisted for exactly that long. **Add a hook here when you add one to a
   * facet.**
   */
  lines.push("", "single-provider hooks — declared by (winner first):");
  for (const hook of [
    "wrapCode",
    "resolveVirtualPath",
    "isVirtualId",
    "dynamicImportTemplate",
    "hmrInjectionCode",
    "hmrSelfAcceptCode",
    "detectLocale",
  ]) {
    lines.push(`  ${hook}: ${declarersOf(resolved.facets, hook).join(" > ") || "(none)"}`);
  }

  lines.push("", "single-provider hooks — resolved on the system view:");
  for (const key of [
    "ssrWrapCode",
    "resolveVirtualPath",
    "isVirtualId",
    "dynamicImportTemplate",
    "hmrInjectionCode",
    "hmrSelfAcceptCode",
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
   * Exactly one bundler facet, and it must be the one belonging to the host that
   * actually builds the example. Both halves matter: none means a missing
   * dynamic-import template surfacing much further downstream, two means a
   * first-contributor-wins race deciding which host's syntax gets emitted.
   *
   * It used to assert the literal `["vite"]`, which was true while `examples/`
   * was Vite-only and became a lie the moment `rsbuild-vanilla-basic` was promoted — the
   * check would have kept passing by describing that app as resolving
   * `viteFacet`, which is exactly the defect ledger L-012 was: Vite syntax
   * emitted into Rspack output.
   */
  it("every example resolves exactly one bundler facet, matching its host", () => {
    for (const name of exampleNames()) {
      const root = join(EXAMPLES_DIR, name);
      const bundler = bundlerFor(name);
      const resolved = resolveFacets(
        assembleFacets({
          frameworks: detectFrameworks({ root }),
          bundler,
          root,
          ssr: false,
        }),
      );
      const bundlerFacets = resolved.facets.filter((f) => f.concern === "bundler");
      expect(
        bundlerFacets.map((f) => f.name),
        name,
      ).toEqual([bundler]);
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
          frameworks: detectFrameworks({ root }),
          bundler: bundlerFor(name),
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
