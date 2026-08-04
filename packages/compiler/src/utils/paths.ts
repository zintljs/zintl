/** Normalizes Windows backslash separators to POSIX forward slashes. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Whether `path` falls under this monorepo's own `examples/` tree. */
export function isExamplePath(path: string): boolean {
  return toPosixPath(path).includes("/examples/");
}
