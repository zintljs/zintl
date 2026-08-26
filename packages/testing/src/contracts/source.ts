import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "../utils.js";
import type { ZintlPluginOptions } from "../environment/driver.js";

const MONOREPO_ROOT = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * A project directory the lab can boot, plus whatever teardown it needs.
 *
 * Anything the driver touches — `vite.config.*` or `rsbuild.config.mjs`,
 * framework detection, the filesystem snapshot — reads from `root`, so a source
 * only has to produce a real directory. It does not matter whether that
 * directory was authored by hand or written moments ago, or which host will
 * boot it.
 */
export interface MaterializedProject {
  /** Absolute path to a real directory the manifest's driver can boot. */
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

/**
 * Worker-scoped copies already prepared in this process.
 *
 * Granularity is deliberate. Dev servers are pooled by example name in module
 * scope (`sharedServers` in `dev-server.ts`), so every lab for a given example
 * inside one worker must resolve to the *same* root — a per-test copy would
 * leave the pooled server rooted at a directory the next test no longer uses.
 * Per-worker is also the level at which isolation is actually needed: workers
 * run in separate processes, tests inside one run serially.
 */
const preparedCopies = new Set<string>();

/** The same, for inline fixtures — see {@link fixtureSource}. */
const preparedFixtures = new Set<string>();

/** Build artefacts and caches — never worth copying, and stale by definition. */
const COPY_EXCLUDED = new Set(["node_modules", "dist", ".next", ".vite", ".turbo", ".tmp"]);

/**
 * `node_modules` entries the symlink farm must skip.
 *
 * Anything the dev server *writes* has to be per-copy. Linking a write target
 * back to the shared `examples/` tree reintroduces exactly the cross-worker
 * contention the copy exists to eliminate — and does so invisibly, because
 * module resolution keeps working perfectly while the cache underneath is being
 * raced by four processes.
 */
const MODULES_NOT_LINKED = new Set([
  ".vite",
  ".cache",
  ".vite-temp",
  /**
   * `.zintl` holds the compiler's persisted manifest, and linking it made the
   * per-worker copy and the **real example** share one.
   *
   * The consequence was not confined to the test run. A contract that renamed a
   * file wrote the phantom boundary into the shared manifest; the next
   * `build:examples` read it back and generated catalogs for source that did
   * not exist — into the tracked `examples/` tree. Twelve untracked JSON files
   * across four examples, from a single contract.
   *
   * This is the same rule as `.vite` above, and it was missed for the same
   * reason: module resolution keeps working perfectly while the state
   * underneath is shared, so nothing looks wrong until an artifact outlives the
   * run that produced it.
   */
  ".zintl",
]);

function workerId(): string {
  return process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);
}

/**
 * An `examples/` project copied into a worker-private directory.
 *
 * Contracts mutate their project — `lab.fs.edit(adapter.headingFile)` — and
 * several contracts target the same file of the same example. Run those in
 * parallel against the shared `examples/` tree and workers overwrite each
 * other's edits; measured, that produced 31 failures out of 72 and corrupted
 * the working tree. Giving each worker its own copy removes the shared mutable
 * state that makes `maxWorkers: 1` mandatory.
 *
 * `node_modules` is reproduced as a shallow farm of symlinks rather than copied
 * or linked wholesale: linking the directory itself would send Vite's
 * `node_modules/.vite` cache writes back into the real example, reintroducing
 * cross-worker contention through the back door.
 */
export function copiedExampleSource(dir: string): ProjectSource {
  return {
    id: dir,
    async materialize(): Promise<MaterializedProject> {
      const origin = join(MONOREPO_ROOT, "examples", dir);
      if (!existsSync(origin)) {
        throw new Error(`Example fixture directory not found: ${dir}`);
      }
      return prepareWorkerCopy(origin, dir);
    },
  };
}

/**
 * Copy a project into a worker-private directory, once per worker.
 *
 * Shared by {@link copiedExampleSource} and {@link dirSource}; the copy rules
 * are the interesting part and are documented at their definitions above.
 */
async function prepareWorkerCopy(origin: string, id: string): Promise<MaterializedProject> {
  const root = join(MONOREPO_ROOT, ".tmp", "runs", `w${workerId()}`, id);

  if (!preparedCopies.has(root)) {
    await rm(root, { recursive: true, force: true });
    await cp(origin, root, {
      recursive: true,
      filter: (src) => !COPY_EXCLUDED.has(basename(src)),
    });

    const originModules = join(origin, "node_modules");
    if (existsSync(originModules)) {
      const target = join(root, "node_modules");
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(originModules)) {
        /**
         * `.vite` must NOT be linked. It is Vite's dependency-optimization
         * cache, which the dev server writes to — linking it sends every
         * worker's writes into the one shared directory under `examples/`,
         * which is the exact contention this copy exists to remove.
         * Omitting it lets each copy create its own.
         */
        if (MODULES_NOT_LINKED.has(entry)) continue;
        await symlink(join(originModules, entry), join(target, entry)).catch(() => {
          // Entry already linked, or unsupported — resolution falls back to
          // walking up to the workspace root, which still resolves.
        });
      }

      /**
       * `.zintl` is **copied**, not linked and not omitted.
       *
       * Linking it shares the compiler's persisted manifest between the copy
       * and the real example, so a contract that renames or deletes a file
       * writes a phantom boundary into `examples/`, and the next
       * `build:examples` generates catalogs for source that no longer exists
       * — into the tracked tree.
       *
       * Omitting it is not the fix either, and that was measured: a compiler
       * starting cold resolves boundary ownership differently from one
       * reading a saved manifest (`src/App.tsx:App` moved from
       * `src/main.tsx:bootstrap` to an anonymous `src/main.tsx:f_547`), which
       * changed four committed graph snapshots. That difference is worth
       * investigating on its own — ZRS Axiom 4 says ownership is
       * deterministic — but it is not this function's problem to absorb.
       *
       * Copying gives every worker the same warm starting state with no
       * shared mutable file, which is the property the whole per-worker copy
       * exists to provide.
       */
      const originZintl = join(originModules, ".zintl");
      if (existsSync(originZintl)) {
        await cp(originZintl, join(target, ".zintl"), { recursive: true });
      }
    }

    preparedCopies.add(root);
  }

  return {
    root,
    async cleanup() {
      // Intentionally retained: the pooled dev server for this example
      // outlives the lab and still needs this root. The whole
      // `.tmp/runs/w<id>` tree is rebuilt on the worker's next first use.
    },
  };
}

/**
 * A checked-in project directory anywhere in the repo, copied per worker.
 *
 * The gap this fills sits between the two sources above it.
 * `copiedExampleSource` is hardcoded to `examples/`, and anything placed there
 * joins `vpr build:examples`, lint, knip and CI — a maintenance commitment.
 * `fixtureSource` avoids that but defines the project as an inline
 * `Record<path, contents>`, which stops being readable somewhere around a
 * dozen files and cannot hold binary assets at all.
 *
 * So: a real directory, version controlled and editable with normal tooling,
 * that no build or lint gate walks into. It was added for the proposal 026
 * Rsbuild target, which must not enter `vpr ci` while it is a spike, and is
 * not specific to that.
 *
 * `dir` is relative to the monorepo root. Copy semantics — the exclusions, the
 * `node_modules` symlink farm, the copied `.zintl` — are shared with
 * {@link copiedExampleSource}, and the reasoning for each is documented there.
 */
export function dirSource(dir: string, id?: string): ProjectSource {
  const sourceId = id ?? basename(dir);
  return {
    id: sourceId,
    async materialize(): Promise<MaterializedProject> {
      const origin = join(MONOREPO_ROOT, dir);
      if (!existsSync(origin)) {
        throw new Error(`Project directory not found: ${dir}`);
      }
      return prepareWorkerCopy(origin, sourceId);
    },
  };
}

export interface FixtureDefinition {
  /** Stable, filesystem-safe identity. Becomes the snapshot directory name. */
  id: string;
  /**
   * The whole project, as a path → contents map. Paths are relative to the
   * project root and may nest (`src/locales/src/about.ar.txt`).
   *
   * A string is written as UTF-8. `{ base64 }` is written as raw bytes, which is
   * how a fixture expresses a file that is not text at all — a `.png`, a `.pdf`,
   * a font. That became expressible because it became testable: a targeted
   * binary asset is delivered by reference now, and a harness that could only
   * write UTF-8 could not state the case at all.
   */
  files: Record<string, string | { base64: string }>;
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
  /**
   * Worker-scoped, for the same reasons {@link copiedExampleSource} is — and it
   * was not, which made it the one shared mutable directory left in the harness.
   *
   * Every fixture materialized to `.tmp/fixtures/<id>`, wiped it on the way in
   * and deleted it on the way out. With more than one worker that is a race with
   * two ways to lose: worker A wipes the directory while worker B is mid-run
   * against it, and worker A's cleanup deletes the tree that worker B's pooled
   * dev server is still serving from. Both fixture-backed manifests
   * (`assets-basic`, `ssr-streaming`) were among the tests observed failing at
   * `maxWorkers: 4`, each time with a different victim — the signature of a
   * race rather than a broken assertion.
   */
  const root = join(MONOREPO_ROOT, ".tmp", "fixtures", `w${workerId()}`, def.id);

  return {
    id: def.id,
    async materialize(): Promise<MaterializedProject> {
      /**
       * Wiped once per worker, not once per lab.
       *
       * The wipe exists so a previous *run*'s leftovers cannot become invisible
       * extra inputs. Repeating it per lab does not serve that and actively
       * breaks things: dev servers are pooled by name and outlive the lab that
       * created them, so a second lab for the same fixture would delete the tree
       * out from under a server still serving it. Same reasoning as
       * `preparedCopies`.
       */
      if (!preparedFixtures.has(root)) {
        await rm(root, { recursive: true, force: true });
        preparedFixtures.add(root);
      }
      await mkdir(root, { recursive: true });

      const files = { ...def.files };
      if (!files["vite.config.ts"]) {
        files["vite.config.ts"] = generateViteConfig(def.zintlOptions ?? {});
      }

      for (const [relPath, contents] of Object.entries(files)) {
        const absPath = join(root, relPath);
        await mkdir(dirname(absPath), { recursive: true });
        if (typeof contents === "string") {
          await writeFile(absPath, contents, "utf-8");
        } else {
          await writeFile(absPath, Buffer.from(contents.base64, "base64"));
        }
      }

      return {
        root,
        /**
         * Intentionally a no-op, matching {@link copiedExampleSource}.
         *
         * Deleting here was the second half of the race: a lab tears down while
         * the pooled dev server for that fixture is still running, and the next
         * lab to reuse that server finds no project on disk. Determinism comes
         * from the once-per-worker wipe in `materialize()`; residue is inert,
         * since `.tmp/` is gitignored and the next run wipes on first use.
         */
        async cleanup() {
          // See above — the directory outlives the lab on purpose.
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
