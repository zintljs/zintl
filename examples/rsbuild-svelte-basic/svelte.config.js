/**
 * Present for `svelte-check`, not for the build.
 *
 * `@rsbuild/plugin-svelte` configures `svelte-loader` itself and reads nothing
 * from here. `svelte-check`, though, looks for a Svelte configuration and — with
 * none — falls back to hunting for `@sveltejs/vite-plugin-svelte` inside a Vite
 * config, which an Rsbuild app does not have. It then reports every component as
 * `Error in vite.config`, which is a confusing way to say "I could not find my
 * settings".
 *
 * @type {import("svelte/compiler").CompileOptions}
 */
export default {};
