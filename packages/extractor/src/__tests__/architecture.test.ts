/**
 * The extractor is the dumbest layer, enforced.
 *
 * It walks ASTs and stitches strings against a *pre-compiled* extraction state
 * handed to it. It must not know what React, Vue, Svelte or Next.js are.
 *
 * It used to. `targets.ts` carried `TARGET_PRESETS` (full descriptor lists for
 * six frameworks), `TARGET_METADATA` (Vue/Svelte SFC block rules, Svelte's
 * mustache pattern, Next.js metadata suppression) and `DEFAULT_SFC_RULES` — and
 * `parser.ts` applied that last one to any `.vue`/`.svelte` file even when the
 * caller supplied no rules at all. Every one of those duplicated a facet preset
 * in `@zintl/compiler/facets`, which is now the single source of truth.
 */
import { describe, it, expect } from "vite-plus/test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === "__tests__" || e.name === "__bench__") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strip line/block comments so prose explaining the boundary is allowed. */
function stripComments(src: string): string[] {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks.split("\n").map((l) => l.replace(/\/\/.*$/, ""));
}

describe("extractor architecture invariants", () => {
  it("names no framework anywhere in its source", async () => {
    const FORBIDDEN = /\b(react|vue|svelte|nextjs)\b/i;
    const offenders: string[] = [];

    for (const file of await walk(SRC)) {
      const src = await readFile(file, "utf-8");
      for (const [i, line] of stripComments(src).entries()) {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("exposes no framework preset tables", async () => {
    const targets = await readFile(join(SRC, "targets.ts"), "utf-8");
    expect(targets).not.toContain("TARGET_PRESETS");
    expect(targets).not.toContain("TARGET_METADATA");
    expect(targets).not.toContain("DEFAULT_SFC_RULES");
  });

  it("has no default target set — callers declare their own sinks", async () => {
    const { resolveTargets } = await import("../targets.js");
    const empty = resolveTargets([]);

    expect(empty.jsxAttributes.size).toBe(0);
    expect(empty.domProperties.size).toBe(0);
    expect(empty.objectFields.size).toBe(0);
    expect(empty.htmlAttributes.size).toBe(0);
    expect(empty.sfcRules).toEqual([]);
    expect(empty.suppressionRules).toEqual([]);
    expect(empty.mustacheRegex).toBeNull();
  });
});
