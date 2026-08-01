import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "../utils.js";

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
