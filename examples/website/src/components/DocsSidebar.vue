<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";
import { getSections } from "../nav";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

// Reading `locale` is what re-resolves the titles when the catalog swaps; see
// the comment on `nav()`.
const sections = computed(() => {
  void locale.value;
  return getSections();
});

const activeSection = computed(() => route.params.section as string | undefined);
const activeSlug = computed(() => route.params.slug as string | undefined);

const isOpen = ref(false);

const activePageTitle = computed(() => {
  for (const s of sections.value) {
    if (s.id === activeSection.value) {
      const p = s.pages.find((page) => page.slug === activeSlug.value);
      if (p) return `${s.title} / ${p.title}`;
    }
  }
  return "Documentation";
});

function toggleMobile() {
  isOpen.value = !isOpen.value;
}

function onLinkClick() {
  isOpen.value = false;
}

// Close mobile drawer when route changes
watch(
  () => route.path,
  () => {
    isOpen.value = false;
  },
);
</script>

<template>
  <aside class="sidebar" aria-label="Documentation">
    <!-- Mobile toggle trigger -->
    <!-- @zintl-ignore -->
    <button
      class="mobile-toggle"
      type="button"
      :aria-expanded="isOpen"
      aria-controls="sidebar-nav-tree"
      @click="toggleMobile"
    >
      <span class="mobile-toggle-info">
        <svg
          class="book-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span class="mobile-toggle-label">{{ activePageTitle }}</span>
      </span>
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

    <nav id="sidebar-nav-tree" class="sidebar-nav" :class="{ 'is-open': isOpen }">
      <div v-for="section in sections" :key="section.id" class="group">
        <p class="group-title">{{ section.title }}</p>
        <ul>
          <li v-for="page in section.pages" :key="page.slug">
            <RouterLink
              :to="`/${locale}/${section.id}/${page.slug}`"
              class="link"
              :class="{ active: activeSection === section.id && activeSlug === page.slug }"
              @click="onLinkClick"
            >
              {{ page.title }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  position: sticky;
  inset-block-start: var(--header-height);
  align-self: start;
  max-height: calc(100vh - var(--header-height));
  overflow-y: auto;
  padding-block: var(--space-6);
  padding-inline-end: var(--space-4);
}

.mobile-toggle {
  display: none;
}

.group + .group {
  margin-block-start: var(--space-6);
}

.group-title {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
  margin: 0 0 var(--space-3);
}

.sidebar ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border-inline-start: 1px solid var(--border);
}

.link {
  display: block;
  padding: 0.3rem 0 0.3rem var(--space-4);
  padding-inline-start: var(--space-4);
  margin-inline-start: -1px;
  border-inline-start: 1px solid transparent;
  font-size: var(--text-base);
  color: var(--text);
  transition:
    color var(--duration) var(--ease),
    border-color var(--duration) var(--ease);
}

.link:hover {
  color: var(--text-strong);
  border-inline-start-color: var(--border);
}

.link.active {
  color: var(--accent);
  font-weight: 560;
  border-inline-start-color: var(--accent);
}

@media (max-width: 60rem) {
  .sidebar {
    position: static;
    max-height: none;
    padding-block: var(--space-4);
    padding-inline-end: 0;
    border-block-end: 1px solid var(--border);
    background: var(--bg-overlay);
  }

  .mobile-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.65rem var(--space-4);
    background: var(--bg-mute);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--text-sm);
    font-weight: 550;
    color: var(--text-strong);
    cursor: pointer;
    transition: background var(--duration) var(--ease);
  }

  .mobile-toggle:hover {
    background: var(--bg-overlay);
  }

  .mobile-toggle-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .book-icon {
    width: 1.1rem;
    height: 1.1rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .mobile-toggle-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron-icon {
    width: 1rem;
    height: 1rem;
    color: var(--text-soft);
    transition: transform var(--duration) var(--ease);
    flex-shrink: 0;
  }

  .chevron-icon.open {
    transform: rotate(180deg);
  }

  .sidebar-nav {
    display: none;
    margin-block-start: var(--space-4);
    padding-inline: var(--space-2);
  }

  .sidebar-nav.is-open {
    display: block;
  }
}
</style>
