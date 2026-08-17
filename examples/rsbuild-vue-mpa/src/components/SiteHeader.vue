<script setup lang="ts">
import { zintl } from "zintljs/macro";

/**
 * A shared component with its **own** trust anchor.
 *
 * Both pages import this, and it awaits `zintl(locale)` itself rather than
 * inheriting from whichever page mounted it. An anchor is independent, so this
 * header's strings form one boundary shared by both entries rather than being
 * duplicated into each.
 *
 * `<Suspense>` in each page's root is what lets this top-level `await` work.
 */
const props = defineProps<{ lang: string }>();

await zintl(props.lang);
</script>

<template>
  <header class="site-header">
    <nav class="nav">
      <a href="/">Home</a>
      <a href="/about">Guide</a>
    </nav>
  </header>
</template>

<style scoped>
.nav {
  display: flex;
  gap: 1.25rem;
}

.site-header {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  display: flex;
  gap: 1.25rem;
  justify-content: center;
  padding: 1rem;
  font-size: 0.95rem;
}

.site-header a {
  color: #fff;
  opacity: 0.75;
  text-decoration: none;
}

.site-header a:hover {
  opacity: 1;
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
