import { execSync } from "node:child_process";

/**
 * Global Vitest Teardown
 *
 * Runs after all tests have completed to surgically remove all .tmp
 * directories across the monorepo. This replaces the slow per-test
 * cleanup with a single, high-speed batch operation.
 */
export function teardown() {
  // Only log if we are in a TTY or explicitly verbose

  try {
    // Root .tmp
    execSync("rm -rf .tmp", { stdio: "ignore" });

    // Package-level .tmp folders in packages and examples
    execSync('find packages examples -name ".tmp" -type d -prune -exec rm -rf {} +', {
      stdio: "ignore",
    });
  } catch {
    // Silently fail if nothing to clean
  }
}
