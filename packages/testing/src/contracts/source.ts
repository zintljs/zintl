import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "../utils.js";
import type { ZintlPluginOptions } from "../environment/driver.js";

const MONOREPO_ROOT = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * A project directory the lab can boot, plus whatever teardown it needs.
 *
 * Anything the driver touches — `vite.config.*`, framework detection, the
 * filesystem snapshot — reads from `root`, so a source only has to produce a
 * real directory. It does not matter whether that directory was authored by
 * hand or written moments ago.
 */
export interface MaterializedProject {
  /** Absolute path to a real directory Vite can boot. */
  readonly root: string;
  /** Release anything `materialize()` allocated. */
  cleanup(): Promise<void>;
}

/**
 * Where a manifest's project comes from.
 *
 * This is the seam that decouples contracts from `examples/`. Contracts already
 * never name an example — they declare `requires` and are matched by
 * capability — so swapping the origin of the project changes nothing above
 * this interface.
 */
export interface ProjectSource {
  /**
   * Stable identity for this project.
   *
   * Used as the `ViteDriver` compilation cache key and as the snapshot
   * directory name, so it must be deterministic and filesystem-safe. For
   * example-backed sources this is the directory name, which keeps snapshot
   * paths identical to what they were before sources existed.
   */
  readonly id: string;
  materialize(): Promise<MaterializedProject>;
}

/**
 * A project that already exists on disk under `examples/`.
 *
 * Materialization is a no-op lookup: the directory is authored and version
 * controlled, so there is nothing to write and nothing to clean up.
 */
export function exampleSource(dir: string): ProjectSource {
  return {
    id: dir,
    async materialize(): Promise<MaterializedProject> {
      const root = join(MONOREPO_ROOT, "examples", dir);
      if (!existsSync(root)) {
        throw new Error(`Example fixture directory not found: ${dir}`);
      }
      return {
        root,
        async cleanup() {
          // Nothing to release — the directory is version controlled.
        },
      };
    },
  };
}

export interface FixtureDefinition {
  /** Stable, filesystem-safe identity. Becomes the snapshot directory name. */
  id: string;
  /**
   * The whole project, as a path → contents map. Paths are relative to the
   * project root and may nest (`src/locales/src/about.ar.txt`).
   */
  files: Record<string, string>;
  /**
   * Plugin options for the generated `vite.config.ts`.
   *
   * Ignored when `files` supplies its own `vite.config.ts` — author one by hand
   * when a fixture needs plugins or config the generator does not cover.
   */
  zintlOptions?: ZintlPluginOptions;
}

/**
 * A project defined inline in the test that uses it.
 *
 * Fixtures exist to cover combinations no example application does — a feature
 * against a framework, or against a bundler — without paying for a whole demo
 * app per combination. They are caricatures of real apps by design, so they
 * complement `exampleSource` rather than replacing it: keep the examples as the
 * integration truth and use fixtures for breadth.
 *
 * Materialization writes under `.tmp/fixtures/` inside the monorepo, not the OS
 * temp directory. That is deliberate — Node resolves `node_modules` by walking
 * parents, so a project inside the repo can import `zintljs`, `vite`, and the
 * framework plugins for free. (The publish smoke test goes out of its way to do
 * the opposite, precisely so it cannot benefit from this.)
 *
 * Set `ZINTL_KEEP_FIXTURES=1` to leave materialized fixtures on disk for
 * inspection after a run.
 */
export function fixtureSource(def: FixtureDefinition): ProjectSource {
  const root = join(MONOREPO_ROOT, ".tmp", "fixtures", def.id);

  return {
    id: def.id,
    async materialize(): Promise<MaterializedProject> {
      // Always start from nothing: a fixture is defined entirely by `files`, so
      // leftovers from a previous run would be invisible extra inputs.
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });

      const files = { ...def.files };
      if (!files["vite.config.ts"]) {
        files["vite.config.ts"] = generateViteConfig(def.zintlOptions ?? {});
      }

      for (const [relPath, contents] of Object.entries(files)) {
        const absPath = join(root, relPath);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, contents, "utf-8");
      }

      return {
        root,
        /**
         * Best-effort. Determinism comes from the wipe in `materialize()`, not
         * from here: dev servers are pooled and outlive an individual lab, so a
         * server can flush catalogs and re-create part of this directory after
         * its lab has torn down. Residue is inert — `.tmp/` is gitignored and
         * the next run starts by deleting the directory outright.
         */
        async cleanup() {
          if (process.env.ZINTL_KEEP_FIXTURES) return;
          await rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}

/**
 * The default `vite.config.ts` for a fixture: the Zintl plugin and nothing else.
 *
 * Options are serialized rather than imported so the fixture stays a plain
 * directory on disk that can be booted, inspected, or copied out by hand.
 */
function generateViteConfig(zintlOptions: ZintlPluginOptions): string {
  return [
    `import { defineConfig } from "vite";`,
    `import zintl from "zintljs/vite";`,
    ``,
    `export default defineConfig({`,
    `  logLevel: "silent",`,
    `  plugins: [zintl(${JSON.stringify(zintlOptions, null, 2)})],`,
    `});`,
    ``,
  ].join("\n");
}
