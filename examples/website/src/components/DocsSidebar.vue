<script setup lang="ts">
import { computed } from "vue";
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
</script>

<template>
  <nav class="sidebar" aria-label="Documentation">
    <div v-for="section in sections" :key="section.id" class="group">
      <!--
        A `<p>`, not an `<h2>`.

        These are labels for grouped links inside a navigation landmark, not
        sections of the document. As headings they appeared *before* the page's
        own `<h1>`, so every docs page opened its outline at level two and then
        went back up — which is what a screen reader reads out. The list markup
        carries the grouping; the landmark carries the name.
      -->
      <p class="group-title">{{ section.title }}</p>
      <ul>
        <li v-for="page in section.pages" :key="page.slug">
          <RouterLink
            :to="`/${locale}/${section.id}/${page.slug}`"
            class="link"
            :class="{ active: activeSection === section.id && activeSlug === page.slug }"
          >
            {{ page.title }}
          </RouterLink>
        </li>
      </ul>
    </div>
  </nav>
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
  /* The rail the active marker sits on, so the list reads as one column
     rather than as items that happen to be stacked. */
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
</style>
