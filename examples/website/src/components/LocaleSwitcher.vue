<!--
  The locale bar.

  It keeps the contract every example's bar keeps — `#switcher.switcher`, one
  element per locale carrying `data-lang`, the active one marked `.active` and
  `aria-current` — so anything that drives an example can drive this. What it
  drops is that bar's decorative frame (the ticks, the bordered mark), because
  this site has a header of its own and the mark already sits in it.

  The elements are `<a>` rather than `<button>`, which `docs/examples-locale-bar.md`
  reserves for apps that navigate. This one does both: the href is real, so the
  link is shareable and middle-clickable, and the click is intercepted so the
  switch is a catalog swap and a repaint with nothing reloading.
-->
<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { zintl } from "zintljs/macro";
import { localeBar, localeFromPath, swapLocale, withBase, type LocaleId } from "../locale";

const route = useRoute();
const router = useRouter();

const active = computed(() => localeFromPath(route.path));

async function switchTo(id: LocaleId) {
  if (id === active.value) return;

  // Catalog first, URL second. `await zintl` resolves once this locale's
  // catalogs are in hand, so the repaint the store triggers has content to
  // paint; pushing first would navigate into a locale still in flight.
  //
  // The push that follows is then seen by the runtime's own `syncLocale`, which
  // reads the locale off the first path segment and finds it already adopted —
  // a no-op, which is the point of prefixing every locale.
  await zintl(id);
  await router.push(swapLocale(route.path, id));
}

function onClick(event: MouseEvent, id: LocaleId) {
  // Leave modified clicks to the browser: cmd-click is "open in a new tab", and
  // a switcher that swallowed it would be worse than one made of buttons.
  if (event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
    return;
  event.preventDefault();
  void switchTo(id);
}
</script>

<template>
  <div id="switcher" class="switcher">
    <a
      v-for="l in localeBar"
      :key="l.id"
      :href="withBase(swapLocale(route.path, l.id))"
      :data-lang="l.id"
      :lang="l.id"
      :class="{ active: active === l.id }"
      :aria-current="active === l.id ? 'true' : undefined"
      @click="onClick($event, l.id)"
      >{{ l.name }}</a
    >
  </div>
</template>

<style scoped>
.switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--bg-mute);
  border-radius: var(--radius-full);
}

.switcher > a {
  padding: 0.28rem 0.7rem;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-soft);
  white-space: nowrap;
  transition:
    color var(--duration) var(--ease),
    background var(--duration) var(--ease);
}

.switcher > a:hover {
  color: var(--text-strong);
}

.switcher > a.active {
  background: var(--bg);
  color: var(--text-strong);
  box-shadow: var(--shadow-sm);
}
</style>
