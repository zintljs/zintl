<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));
</script>

<template>
  <section class="not-found">
    <!-- @zintl-ignore -->
    <p class="code">404</p>
    <h1>This page isn't here</h1>
    <p>
      The link may be out of date, or the page may have moved. The guide is a good place to pick the
      thread back up.
    </p>
    <RouterLink :to="`/${locale}`">Back to the home page</RouterLink>
  </section>
</template>

<style scoped>
.not-found {
  max-width: var(--width-prose);
  margin-inline: auto;
  padding: var(--space-9) var(--space-5);
  text-align: center;
}

.code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--accent);
  margin-block-end: var(--space-3);
}
</style>
