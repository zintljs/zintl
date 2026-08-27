import { isAbsolute, join } from "node:path";

/** Normalizes Windows backslash separators to POSIX forward slashes. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Whether `path` falls under this monorepo's own `examples/` tree. */
export function isExamplePath(path: string): boolean {
  return toPosixPath(path).includes("/examples/");
}

/**
 * One spelling of "the same file" for output paths.
 *
 * Resolved against `root`, POSIX-separated, with repeated and trailing slashes
 * collapsed — enough to key a map by, which is the only thing it is for. The
 * pruning scan, the catalog path index and the namespace guard all compare
 * paths that different subsystems built, and comparing them meaningfully
 * requires all three to normalize identically; three private copies of these
 * four lines could not guarantee that and one of them silently didn't have to.
 */
export function normalizeOutputPath(root: string, path: string): string {
  const abs = isAbsolute(path) ? path : join(root, path);
  return toPosixPath(abs).replace(/\/+/g, "/").replace(/\/+$/, "");
}
