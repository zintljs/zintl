<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { isLocalePath, localeFromPath, stripBase } from "./locale";
import SiteFooter from "./components/SiteFooter.vue";
import SiteHeader from "./components/SiteHeader.vue";

const router = useRouter();
const route = useRoute();

/**
 * Route an internal link that no `RouterLink` produced.
 *
 * Most links on this site are written in Markdown and rendered to plain
 * `<a href>`, because an authored translation artifact should contain prose
 * rather than framework components. Left alone those are full page loads: the
 * docs would reload the application on every cross-reference, which is both
 * slow and a strange thing for a site whose pitch is that switching languages
 * reloads nothing.
 *
 * Delegated from `<main>` rather than bound per link, since the links arrive
 * through `v-html` and were never Vue's to bind. Everything the browser should
 * keep owning is handed back untouched: modified clicks, non-primary buttons, a
 * `target`, a download, and any href that is not a same-origin path.
 */
function routeInternalLinks(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;

  const anchor = (event.target as HTMLElement | null)?.closest?.("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  if (anchor.hasAttribute("download")) return;

  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return;

  event.preventDefault();
  // A link written without a locale gets the reader's, the same way the
  // Markdown renderer resolves the ones inside a page body.
  const routerPath = stripBase(href);
  void router.push(
    isLocalePath(routerPath) ? routerPath : `/${localeFromPath(route.path)}${routerPath}`,
  );
}
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
  <main id="main" @click="routeInternalLinks">
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
