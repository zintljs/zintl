<script lang="ts">
/**
 * Deliberately written with Vue's **Options API** — a plain `<script>` rather
 * than `<script setup>`. Every other SFC in this repository uses the latter,
 * which is why ledger L-053 went unnoticed: Vue compiles a plain `<script>`
 * component's template into a separate render function, so the `_t` and
 * manager bindings Zintl injects into a script block are not in scope there and
 * the paragraph below rendered empty.
 *
 * Zintl now authors a `<script setup>` block beside this one to carry those
 * bindings. `api` proves the two coexist: it is Options-API `data`, resolved
 * through the component instance, inside a sentence whose surrounding text is
 * resolved through setup.
 *
 * The twin of `examples/vue-basic/src/components/OptionsNote.vue` — the defect
 * was found on Rspack and is not Rspack's, so it is watched on both hosts.
 */
export default {
  name: "OptionsNote",
  data() {
    return { api: "Options API" };
  },
};
</script>

<template>
  <p class="options-note">This note comes from the {{ api }}.</p>
</template>
