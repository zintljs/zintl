<!--
  Search across the docs, in the language you are reading.

  The index is built at build time and imported on the first keypress, so a
  reader who never searches never downloads it, and a reader who searches in
  Spanish downloads only the Spanish one.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { localeFromPath } from "../locale";
import type { SearchEntry } from "../lib/search";

const route = useRoute();
const router = useRouter();
const locale = computed(() => localeFromPath(route.path));

const open = ref(false);
const query = ref("");
const selected = ref(0);
const entries = ref<SearchEntry[]>([]);
const input = ref<HTMLInputElement | null>(null);

/** Restored when the dialog closes, so keyboard focus does not jump to the top. */
let opener: HTMLElement | null = null;

/**
 * One index per locale, fetched once each.
 *
 * The import specifier has to be statically analysable enough for the bundler
 * to emit a chunk per locale, which is why the four are spelled out rather than
 * built from a variable.
 */
const LOADERS: Record<string, () => Promise<{ default: SearchEntry[] }>> = {
  en: () => import("virtual:site-search/en"),
  ar: () => import("virtual:site-search/ar"),
  es: () => import("virtual:site-search/es"),
  zh: () => import("virtual:site-search/zh"),
};

const loaded: Record<string, SearchEntry[]> = {};

async function ensureIndex() {
  const id = locale.value;
  if (!loaded[id]) {
    const loader = LOADERS[id];
    loaded[id] = loader ? (await loader()).default : [];
  }
  entries.value = loaded[id];
}

const results = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  if (!q) return [];

  const scored = entries.value
    .map((entry) => {
      const title = entry.t.toLocaleLowerCase();
      const body = entry.x.toLocaleLowerCase();
      // A heading match is what someone is usually after; a body match is a
      // fallback, and ranks below every heading match rather than beside them.
      if (title.startsWith(q)) return { entry, rank: 0 };
      if (title.includes(q)) return { entry, rank: 1 };
      if (body.includes(q)) return { entry, rank: 2 };
      return undefined;
    })
    .filter((hit): hit is { entry: SearchEntry; rank: number } => hit !== undefined);

  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, 8).map((hit) => hit.entry);
});

watch(results, () => (selected.value = 0));

function href(entry: SearchEntry) {
  return `/${locale.value}/${entry.s}/${entry.p}${entry.h ? `#${entry.h}` : ""}`;
}

async function show() {
  opener = document.activeElement as HTMLElement | null;
  open.value = true;
  await ensureIndex();
  await nextTick();
  input.value?.focus();
}

function hide() {
  open.value = false;
  query.value = "";
  opener?.focus();
}

function choose(entry: SearchEntry) {
  const to = href(entry);
  hide();
  void router.push(to);
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    hide();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    selected.value = Math.min(selected.value + 1, results.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = Math.max(selected.value - 1, 0);
  } else if (event.key === "Enter" && results.value[selected.value]) {
    event.preventDefault();
    choose(results.value[selected.value]);
  }
}

/** The shortcut every docs site has, so nobody has to look for the button. */
function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (open.value) hide();
    else void show();
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
  <button type="button" class="trigger" aria-label="Search the documentation" @click="show">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" stroke-linecap="round" />
    </svg>
    <span class="trigger-label">Search</span>
  </button>

  <div v-if="open" class="backdrop" @click.self="hide">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Search the documentation"
      @keydown="onKeydown"
    >
      <input
        ref="input"
        v-model="query"
        type="search"
        class="input"
        autocomplete="off"
        placeholder="Search the documentation"
        aria-label="Search the documentation"
      />

      <ul v-if="results.length > 0" class="results" role="list">
        <li v-for="(entry, index) in results" :key="href(entry)">
          <a
            :href="href(entry)"
            class="result"
            :class="{ on: index === selected }"
            @click.prevent="choose(entry)"
            @mouseenter="selected = index"
          >
            <!-- @zintl-ignore -->
            <span class="result-title">{{ entry.t }}</span>
            <!-- @zintl-ignore -->
            <span v-if="entry.x" class="result-excerpt">{{ entry.x }}</span>
          </a>
        </li>
      </ul>

      <p v-else-if="query.trim()" class="empty">Nothing matches that.</p>
      <p v-else class="empty">Type to search the pages in this language.</p>
    </div>
  </div>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 2rem;
  padding-inline: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: transparent;
  font-size: var(--text-sm);
  color: var(--text-soft);
  transition:
    color var(--duration) var(--ease),
    border-color var(--duration) var(--ease);
}

.trigger:hover {
  color: var(--text-strong);
  border-color: var(--accent-line);
}

.trigger svg {
  width: 0.95rem;
  height: 0.95rem;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  justify-items: center;
  align-items: start;
  padding: 12vh var(--space-4) var(--space-4);
  background: light-dark(rgba(23, 16, 33, 0.35), rgba(0, 0, 0, 0.6));
  backdrop-filter: blur(3px);
}

.dialog {
  width: min(38rem, 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.input {
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border: 0;
  border-block-end: 1px solid var(--border);
  background: transparent;
  font: inherit;
  font-size: var(--text-md);
  color: var(--text-strong);
}

.input:focus {
  outline: none;
}

.results {
  list-style: none;
  margin: 0;
  padding: var(--space-2);
  max-height: 22rem;
  overflow-y: auto;
}

.result {
  display: block;
  padding: var(--space-3);
  border-radius: var(--radius);
  color: var(--text);
}

.result.on {
  background: var(--accent-soft);
}

.result-title {
  display: block;
  font-size: var(--text-base);
  font-weight: 560;
  color: var(--text-strong);
}

.result.on .result-title {
  color: var(--accent);
}

.result-excerpt {
  display: block;
  margin-block-start: 0.15rem;
  font-size: var(--text-sm);
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 0;
  padding: var(--space-5);
  font-size: var(--text-base);
  color: var(--text-soft);
  text-align: center;
}

@media (max-width: 48rem) {
  .trigger-label {
    display: none;
  }

  .trigger {
    padding-inline: var(--space-2);
  }
}
</style>
