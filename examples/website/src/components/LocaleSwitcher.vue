<!--
  The locale bar.

  It keeps the contract every example's bar keeps — `#switcher.switcher`, one
  element per locale carrying `data-lang`, the active one marked `.active` and
  `aria-current` — so anything that drives an example can drive this.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { zintl } from "zintljs/macro";
import { localeBar, localeFromPath, swapLocale, withBase, type LocaleId } from "../locale";

const route = useRoute();
const router = useRouter();

const active = computed(() => localeFromPath(route.path));
const activeLocale = computed(() => localeBar.find((l) => l.id === active.value) || localeBar[0]);

const isOpen = ref(false);
const switcherRef = ref<HTMLElement | null>(null);

function toggleMenu() {
  isOpen.value = !isOpen.value;
}

function closeMenu() {
  isOpen.value = false;
}

function handleOutsideClick(event: MouseEvent) {
  if (switcherRef.value && !switcherRef.value.contains(event.target as Node)) {
    closeMenu();
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && isOpen.value) {
    closeMenu();
  }
}

onMounted(() => {
  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener("click", handleOutsideClick);
  document.removeEventListener("keydown", handleKeyDown);
});

async function switchTo(id: LocaleId) {
  if (id === active.value) {
    closeMenu();
    return;
  }

  closeMenu();
  await zintl(id);
  await router.push(swapLocale(route.path, id));
}

function onClick(event: MouseEvent, id: LocaleId) {
  if (event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
    return;
  event.preventDefault();
  void switchTo(id);
}
</script>

<template>
  <div id="switcher" ref="switcherRef" class="switcher">
    <!-- @zintl-ignore -->
    <button
      class="switcher-trigger"
      type="button"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      aria-label="Select language"
      @click="toggleMenu"
    >
      <svg
        class="globe-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path
          d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
        />
      </svg>
      <span class="active-label">{{ activeLocale.name }}</span>
      <svg
        class="chevron-icon"
        :class="{ open: isOpen }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-if="isOpen" class="switcher-menu" role="listbox">
      <a
        v-for="l in localeBar"
        :key="l.id"
        :href="withBase(swapLocale(route.path, l.id))"
        :data-lang="l.id"
        :lang="l.id"
        :class="{ active: active === l.id }"
        :aria-current="active === l.id ? 'true' : undefined"
        @click="onClick($event, l.id)"
      >
        <span class="locale-name">{{ l.name }}</span>
        <span class="locale-code">{{ l.id.toUpperCase() }}</span>
        <svg
          v-if="active === l.id"
          class="check-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </a>
    </div>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  display: inline-block;
}

.switcher-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.35rem 0.75rem;
  background: var(--bg-mute);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-strong);
  cursor: pointer;
  transition:
    background var(--duration) var(--ease),
    border-color var(--duration) var(--ease);
}

.switcher-trigger:hover {
  background: var(--bg-overlay);
  border-color: var(--accent-line);
}

.globe-icon {
  width: 1rem;
  height: 1rem;
  color: var(--text-soft);
  flex-shrink: 0;
}

.active-label {
  white-space: nowrap;
}

.chevron-icon {
  width: 0.85rem;
  height: 0.85rem;
  color: var(--text-soft);
  transition: transform var(--duration) var(--ease);
  flex-shrink: 0;
}

.chevron-icon.open {
  transform: rotate(180deg);
}

.switcher-menu {
  position: absolute;
  inset-block-start: calc(100% + 6px);
  inset-inline-end: 0;
  min-width: 12.5rem;
  max-height: 18.5rem;
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-overlay);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Custom scrollbar for switcher dropdown */
.switcher-menu::-webkit-scrollbar {
  width: 4px;
}
.switcher-menu::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.switcher-menu > a {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius);
  font-size: var(--text-sm);
  color: var(--text);
  text-decoration: none;
  transition:
    background var(--duration) var(--ease),
    color var(--duration) var(--ease);
}

.switcher-menu > a:hover {
  background: var(--bg-mute);
  color: var(--text-strong);
}

.switcher-menu > a.active {
  background: var(--bg-mute);
  color: var(--accent);
  font-weight: 560;
}

.locale-name {
  flex-grow: 1;
}

.locale-code {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-soft);
  opacity: 0.7;
}

.check-icon {
  width: 0.85rem;
  height: 0.85rem;
  color: var(--accent);
  flex-shrink: 0;
}
</style>
