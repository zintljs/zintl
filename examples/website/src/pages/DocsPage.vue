<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";
import { findPage } from "../nav";

const route = useRoute();

// `route.path` covers the locale as well as the page, so this recomputes on a
// language switch and the title re-resolves with it.
const entry = computed(() => {
  void localeFromPath(route.path);
  return findPage(route.params.section as string, route.params.slug as string);
});
</script>

<template>
  <article class="docs">
    <h1>{{ entry?.page.title }}</h1>
    <p class="placeholder">
      This page is still being written. The docs shell lands with it in the next step.
    </p>
  </article>
</template>

<style scoped>
.docs {
  max-width: var(--width-prose);
  margin-inline: auto;
  padding: var(--space-8) var(--space-5);
}

.placeholder {
  color: var(--text-soft);
}
</style>
