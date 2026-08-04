/** Whether the compiler is currently running inside the test runner. */
export function isTestEnvironment(): boolean {
  return (
    typeof process !== "undefined" && (process.env.NODE_ENV === "test" || !!process.env.VITEST)
  );
}
