<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";
import { getSections } from "../nav";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

// Reading `locale` is what makes this recompute when the catalog swaps, so the
// titles follow the locale; see the comment on `nav()` for why they otherwise
// freeze in the source language.
const sections = computed(() => {
  void locale.value;
  return getSections();
});
</script>

<template>
  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-lead">
        <p class="footer-tagline">Write your app in plain language. Ship it in every language.</p>
        <p class="footer-note">
          Released under the MIT licence. This site is built with Zintl, and every word on it was
          extracted from plain source by the compiler it documents.
        </p>
      </div>

      <nav
        v-for="section in sections"
        :key="section.id"
        class="footer-column"
        :aria-label="section.title"
      >
        <p>{{ section.title }}</p>
        <ul>
          <li v-for="page in section.pages" :key="page.slug">
            <RouterLink :to="`/${locale}/${section.id}/${page.slug}`">{{ page.title }}</RouterLink>
          </li>
        </ul>
      </nav>

      <nav class="footer-column" aria-label="Project links">
        <p>Project</p>
        <ul>
          <!-- @zintl-ignore -->
          <li><a href="https://github.com/zintljs/zintl">GitHub</a></li>
          <!-- @zintl-ignore -->
          <li><a href="https://npmjs.com/package/zintljs">npm</a></li>
          <li><a href="https://github.com/zintljs/zintl/issues">Report an issue</a></li>
        </ul>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  border-block-start: 1px solid var(--border);
  background: var(--bg-soft);
  margin-block-start: var(--space-9);
}

.footer-inner {
  display: grid;
  grid-template-columns: 1.6fr repeat(4, minmax(0, 1fr));
  gap: var(--space-6);
  max-width: var(--width-shell);
  margin-inline: auto;
  padding: var(--space-8) var(--space-5);
}

.footer-tagline {
  color: var(--text-strong);
  font-weight: 560;
  margin-block-end: var(--space-3);
  max-width: 22rem;
}

.footer-note {
  font-size: var(--text-base);
  color: var(--text-soft);
  max-width: 26rem;
  margin: 0;
}

.footer-column p {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
  margin: 0 0 var(--space-3);
}

.footer-column ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.footer-column a {
  font-size: var(--text-base);
  color: var(--text);
}

.footer-column a:hover {
  color: var(--accent);
}

@media (max-width: 68rem) {
  .footer-inner {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .footer-lead {
    grid-column: 1 / -1;
  }
}
</style>
