<script setup lang="ts">
import SiteFooter from "./components/SiteFooter.vue";
import SiteHeader from "./components/SiteHeader.vue";
</script>

<template>
  <!--
    No `:key` on the locale here, unlike the framework examples.

    Those remount the tree to repaint it. Vue does not need that: the compiler's
    Vue facet gives every component a `subscribe()` to the store's version, so a
    catalog swap invalidates each component where it stands. Remounting would
    throw away scroll position and any open disclosure on the page, for a
    repaint that has already happened.
  -->
  <a class="skip-link" href="#main">Skip to content</a>
  <SiteHeader />
  <main id="main">
    <RouterView v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
      </Suspense>
    </RouterView>
  </main>
  <SiteFooter />
</template>
