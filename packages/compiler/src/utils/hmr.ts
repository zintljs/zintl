/**
 * The `import.meta.hot.accept` snippet used when an entry's HMR update is
 * safe to replay (the framework's mount can re-run without double-mounting).
 *
 * Shared by `facet/presets/vite.ts` (the real HMR contribution, gated on
 * `entryReexecutionSafe`) and `index.ts`'s no-facet fallback (used when a
 * compiler instance has no bundler facet contributing `hmrInjectionCode`,
 * e.g. the compiler's own unit tests) so the literal only lives in one place.
 */
export function selfAcceptHmrSnippet(fileId: string): string {
  return `\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    console.debug("[Zintl] HMR update accepted for: ${fileId}");\n  });\n}`;
}
