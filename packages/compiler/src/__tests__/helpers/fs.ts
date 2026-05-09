import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * Creates a unique temporary directory for testing.
 * Standardizes on a local .tmp folder if possible, falling back to OS tmp.
 */
export async function createTestDir(prefix: string) {
  // Use .tmp in the current working directory (usually package root)
  const base = join(process.cwd(), ".tmp");
  if (!existsSync(base)) {
    await mkdir(base, { recursive: true });
  }
  return await mkdtemp(join(base, prefix));
}

/**
 * Standard test context for directory management.
 */
export type TestContext = {
  root: string;
};
