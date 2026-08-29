<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Heading } from "../lib/markdown";

const props = defineProps<{ headings: Heading[] }>();

const activeId = ref<string>("");
let observer: IntersectionObserver | undefined;

/**
 * Scroll-spy by IntersectionObserver rather than by measuring on every scroll
 * event: the browser already knows where these elements are, and asking it on
 * each frame is how a docs page starts dropping them.
 *
 * The top margin pushes the trigger line down under the sticky header, so a
 * heading becomes "current" when it reaches the top of the *readable* area
 * rather than the top of the viewport it is hidden behind.
 */
function observe() {
  observer?.disconnect();
  if (props.headings.length === 0) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeId.value = entry.target.id;
          break;
        }
      }
    },
    { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
  );

  for (const heading of props.headings) {
    const element = document.getElementById(heading.id);
    if (element) observer.observe(element);
  }
}

onMounted(observe);
watch(() => props.headings, observe, { flush: "post" });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <nav v-if="headings.length > 0" class="toc" aria-label="On this page">
    <p class="toc-title">On this page</p>
    <ul>
      <li v-for="heading in headings" :key="heading.id" :class="`level-${heading.level}`">
        <a :href="`#${heading.id}`" :class="{ active: activeId === heading.id }">
          {{ heading.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.toc {
  position: sticky;
  inset-block-start: var(--header-height);
  align-self: start;
  max-height: calc(100vh - var(--header-height));
  overflow-y: auto;
  padding-block: var(--space-6);
  font-size: var(--text-sm);
}

.toc-title {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
  margin: 0 0 var(--space-3);
}

.toc ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border-inline-start: 1px solid var(--border);
}

.toc a {
  display: block;
  padding: 0.25rem 0;
  padding-inline-start: var(--space-4);
  margin-inline-start: -1px;
  border-inline-start: 1px solid transparent;
  color: var(--text-soft);
  line-height: 1.45;
}

.toc a:hover {
  color: var(--text-strong);
}

.toc a.active {
  color: var(--accent);
  border-inline-start-color: var(--accent);
}

.level-3 a {
  padding-inline-start: var(--space-6);
  font-size: var(--text-xs);
}
</style>
