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
    <!--
      Keyed on the path, which carries the locale.

      The chrome above and below repaints in place, but a routed page whose body
      is an *awaited* localized asset cannot: `await loadPage(...)` runs in
      `setup`, and a store notification does not re-run `setup`. Keying on the
      path rebuilds the page whenever the locale or the slug changes, which is
      exactly when its body has to be fetched again.
    -->
    <RouterView v-slot="{ Component, route }">
      <Suspense>
        <component :is="Component" :key="route.path" />
      </Suspense>
    </RouterView>
  </main>
  <SiteFooter />
</template>
