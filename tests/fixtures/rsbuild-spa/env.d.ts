/**
 * `?raw` imports, declared by hand.
 *
 * The Vite examples get this from `types: ["vite/client"]`. This project is
 * built by Rsbuild, so it has no Vite types to inherit and the query-suffixed
 * specifier would otherwise be a type error under the repo's type-aware lint.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
