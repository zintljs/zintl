---
"@zintl/compiler": patch
---

Fix HMR script injection for Vue and Svelte SFC components. The compiler now detects the closing `</script>` tag in single-file components and embeds the HMR acceptance code block inside it instead of appending it raw at the end of the file, preventing template syntax compilation errors.

Additionally, Zintl now injects a dynamic boundary HMR revision token comment in development mode for transformed components. This forces SFC compilers (like Svelte) to generate a modified signature upon catalog invalidation, prompting Svelte's HMR proxy to correctly swap and re-render component instances when translation catalogs change.
