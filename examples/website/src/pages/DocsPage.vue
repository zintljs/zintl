<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { loadPage } from "../content";
import { renderMarkdown } from "../lib/markdown";
import { localeFromPath } from "../locale";
import { findPage, neighbours } from "../nav";
import DocsSidebar from "../components/DocsSidebar.vue";
import DocsToc from "../components/DocsToc.vue";

const route = useRoute();

const section = route.params.section as string;
const slug = route.params.slug as string;
const locale = localeFromPath(route.path);

/**
 * Resolved once, in `setup`, and that is safe because `App.vue` keys this
 * component on the route path — locale included. A locale switch is a new path,
 * so the page is rebuilt and this await runs again against the new catalog.
 * Nothing here has to watch anything.
 */
const source = await loadPage(section, slug);
const rendered = computed(() => (source ? renderMarkdown(source, locale) : undefined));

const entry = computed(() => findPage(section, slug));
const pager = computed(() => neighbours(section, slug));

const editHref = `https://github.com/zintljs/zintl/edit/main/examples/website/src/content/${slug}.md`;
</script>

<template>
  <div class="docs-layout">
    <DocsSidebar />

    <article class="docs-body">
      <template v-if="rendered">
        <h1>{{ rendered.title || entry?.page.title }}</h1>
        <!--
          The rendered Markdown. `v-html` is the point of the exercise: the body
          is a localized asset, so what lands here is this locale's artifact,
          re-pointed at runtime rather than bound at build time.
        -->
        <!-- @zintl-ignore -->
        <div class="prose" v-html="rendered.html"></div>
      </template>

      <template v-else>
        <h1>{{ entry?.page.title }}</h1>
        <p class="placeholder">This page has not been written yet.</p>
      </template>

      <footer class="docs-footer">
        <a class="edit-link" :href="editHref" target="_blank" rel="noreferrer">
          Edit this page on GitHub
        </a>

        <nav class="pager" aria-label="Previous and next page">
          <RouterLink
            v-if="pager.previous"
            class="pager-link previous"
            :to="`/${locale}/${pager.previous.section.id}/${pager.previous.page.slug}`"
          >
            <span class="pager-kind">Previous</span>
            <span class="pager-title">{{ pager.previous.page.title }}</span>
          </RouterLink>
          <RouterLink
            v-if="pager.next"
            class="pager-link next"
            :to="`/${locale}/${pager.next.section.id}/${pager.next.page.slug}`"
          >
            <span class="pager-kind">Next</span>
            <span class="pager-title">{{ pager.next.page.title }}</span>
          </RouterLink>
        </nav>
      </footer>
    </article>

    <DocsToc :headings="rendered?.headings ?? []" />
  </div>
</template>

<style scoped>
.docs-layout {
  display: grid;
  grid-template-columns: var(--width-sidebar) minmax(0, 1fr) var(--width-toc);
  gap: var(--space-7);
  max-width: var(--width-shell);
  margin-inline: auto;
  padding-inline: var(--space-5);
  align-items: start;
}

.docs-body {
  min-width: 0;
  max-width: var(--width-prose);
  padding-block: var(--space-7) var(--space-8);
}

.docs-body h1 {
  font-size: var(--text-2xl);
  margin-block-end: var(--space-5);
}

.placeholder {
  color: var(--text-soft);
}

.docs-footer {
  margin-block-start: var(--space-8);
  padding-block-start: var(--space-5);
  border-block-start: 1px solid var(--border);
}

.edit-link {
  font-size: var(--text-base);
}

.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-block-start: var(--space-5);
}

.pager-link {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color var(--duration) var(--ease);
}

.pager-link:hover {
  border-color: var(--accent-line);
}

/* `next` sits in the second column even when it is the only link, so a first
   page's "Next" stays on the side the reader is travelling towards — which
   `dir` flips for Arabic without a second rule. */
.pager-link.next {
  grid-column: 2;
  text-align: end;
}

.pager-kind {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-soft);
}

.pager-title {
  color: var(--accent);
  font-weight: 560;
}

@media (max-width: 82rem) {
  .docs-layout {
    grid-template-columns: var(--width-sidebar) minmax(0, 1fr);
  }

  /* Hidden, not just unplaced. Dropping the column leaves the table of
     contents as a third grid item, which wraps onto a second row and — being
     sticky and a viewport tall — opens a screen-height gap under the article. */
  .docs-layout :deep(.toc) {
    display: none;
  }
}

@media (max-width: 60rem) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .docs-layout :deep(.sidebar) {
    position: static;
    max-height: none;
    border-block-end: 1px solid var(--border);
    padding-inline-end: 0;
  }
}
</style>
