import { join } from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";

/**
 * Scratch directories for tests, scoped to the worker that made them.
 *
 * Callers do not remove what they create — forty-odd test files use this and
 * none of them clean up — so the base is cleared once when a worker first asks
 * for a directory. That bounds the tree at one run's worth per worker instead
 * of every run ever performed: before this, `.tmp` had grown past 70 MB of
 * `html-deep-*` and friends, invisible because `.tmp` is gitignored.
 *
 * Per-worker is the load-bearing part. Vitest runs workers as separate
 * processes against one working directory, so a shared base would let whichever
 * worker started last delete the directories the others were still using.
 */
const WORKER_ID = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);

const base = join(process.cwd(), ".tmp", `w${WORKER_ID}`);

/** Cleared at most once per process; every caller awaits the same promise. */
let prepared: Promise<void> | null = null;

function prepareBase(): Promise<void> {
  prepared ??= (async () => {
    await rm(base, { recursive: true, force: true }).catch(() => {});
    await mkdir(base, { recursive: true });
  })();
  return prepared;
}

/**
 * Creates a unique temporary directory for testing.
 */
export async function createTestDir(prefix: string) {
  await prepareBase();
  return await mkdtemp(join(base, prefix));
}

/**
 * Standard test context for directory management.
 */
export type TestContext = {
  root: string;
};
