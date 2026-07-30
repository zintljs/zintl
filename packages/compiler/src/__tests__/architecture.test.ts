/**
 * The line, enforced.
 *
 * Knowledge in this project flows one way only:
 *
 *   extractor  ←  compiler (core)  ←  compiler/facets  ←  zintl (plugin)
 *
 * The compiler core receives capabilities and executes them. It must not reach
 * into `./facet/**`, because that is where React, Vue, Svelte, Next, SSR, HTML,
 * assets and Vite live. A single import in the wrong direction quietly restores
 * the coupling this architecture exists to remove, so it is asserted rather than
 * left to review.
 */
import { describe, it, expect } from "vite-plus/test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Directories that constitute the compiler core. */
const CORE_DIRS = ["pipeline", "managers", "types", "utils", "capabilities", "runtime"];
const CORE_ROOT_FILES = ["index.ts", "reconcile.ts", "constants.ts", "types.ts"];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function coreFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const d of CORE_DIRS) {
    try {
      files.push(...(await walk(join(SRC, d))));
    } catch {
      // directory may not exist; that is fine
    }
  }
  for (const f of CORE_ROOT_FILES) files.push(join(SRC, f));
  return files;
}

const FACET_IMPORT = /from\s+["'][^"']*\/facet\/[^"']*["']|from\s+["']\.\.?\/facet["']/;

describe("architecture invariants", () => {
  it("compiler core never imports from ./facet/**", async () => {
    const offenders: string[] = [];

    for (const file of await coreFiles()) {
      let src: string;
      try {
        src = await readFile(file, "utf-8");
      } catch {
        continue;
      }
      for (const [i, line] of src.split("\n").entries()) {
        if (FACET_IMPORT.test(line)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("compiler core never names a framework or bundler", async () => {
    // Framework knowledge belongs in ./facet/presets/**, never in the engine.
    const FORBIDDEN = /\b(react|vue|svelte|nextjs|vite)\b/i;
    const offenders: string[] = [];

    for (const file of await coreFiles()) {
      let src: string;
      try {
        src = await readFile(file, "utf-8");
      } catch {
        continue;
      }
      for (const [i, line] of src.split("\n").entries()) {
        // Strip comments — prose may legitimately explain the boundary.
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (code.trim().startsWith("*")) continue;
        if (FORBIDDEN.test(code)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
