<!--
  Plurals, demonstrated by actually having some.

  The sentence below is an ordinary line of markup, so it becomes an ordinary
  key, and the grammar lives in this site's own catalogs. What you are reading
  when you press the buttons is Zintl resolving a real message in the language
  you chose — not a mock of what it would do.

  The six counts are the six Arabic plural categories: 0 zero, 1 one, 2 two,
  3 few, 11 many, 100 other. English needs none of them for this sentence, which
  is the point being made.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

const count = ref(3);
const STEPS = [0, 1, 2, 3, 11, 100];

/**
 * The catalog entry for each language, shown beside the sentence.
 *
 * A copy of what is in `zintl/src/components/PluralDemo.vue.<locale>.json`,
 * because nothing exposes a catalog to the page at runtime and inventing an API
 * for one illustration would be worse than this. If the catalogs change, these
 * change with them — the comment is the only thing keeping them honest.
 */
const CATALOG: Record<string, string> = {
  en: "(no entry — this is the source language)",
  ar: "{count, plural,\n  zero {…} one {…} two {…}\n  few {…} many {…} other {…}}",
  es: "{count, plural,\n  one {…} other {…}}",
  zh: "(no plural forms — Chinese needs none)",
};

const formCount: Record<string, number> = { en: 0, ar: 6, es: 2, zh: 0 };
</script>

<template>
  <div class="plural">
    <div class="stage">
      <!--
        One line of markup. The interpolation becomes a stable placeholder, and
        the placeholder is what a translator branches on.
      -->
      <p class="sentence">Showing {{ count }} of 12 files</p>
    </div>

    <div class="controls">
      <button type="button" class="step" aria-label="Fewer" @click="count = Math.max(0, count - 1)">
        <!-- @zintl-ignore -->
        <span>−</span>
      </button>
      <button
        v-for="value in STEPS"
        :key="value"
        type="button"
        class="jump"
        :class="{ on: count === value }"
        @click="count = value"
      >
        <!-- @zintl-ignore -->
        {{ value }}
      </button>
      <button type="button" class="step" aria-label="More" @click="count = count + 1">
        <!-- @zintl-ignore -->
        <span>+</span>
      </button>
    </div>

    <div class="explain">
      <p class="explain-line">
        <span class="explain-kind">Your source</span>
        <!-- @zintl-ignore -->
        <code>Showing {count} of 12 files</code>
      </p>
      <p class="explain-line">
        <span class="explain-kind">This language's catalog</span>
        <!-- @zintl-ignore -->
        <code class="catalog">{{ CATALOG[locale] }}</code>
      </p>
      <p class="forms">
        <template v-if="formCount[locale] === 0">
          This language needs no plural forms for this sentence, so its catalog carries none.
        </template>
        <template v-else-if="formCount[locale] === 2">
          Two forms, because that is what this language distinguishes.
        </template>
        <template v-else>
          Six forms, because Arabic has six. Your source still says one sentence.
        </template>
      </p>
    </div>

    <p class="plural-note">
      Switch the language in the bar at the top and press the numbers again. The grammar changes;
      the line in your source does not. And none of it reaches the browser as a rule to interpret —
      the forms compile to plain JavaScript at build time.
    </p>
  </div>
</template>

<style scoped>
.plural {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
  padding: var(--space-5);
}

.stage {
  display: grid;
  place-items: center;
  min-height: 5rem;
  padding: var(--space-5);
  border-radius: var(--radius);
  background: var(--bg-code);
  border: 1px solid var(--border);
}

.sentence {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 560;
  color: var(--text-strong);
  text-align: center;
  text-wrap: balance;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-block-start: var(--space-4);
}

.step,
.jump {
  min-width: 2.4rem;
  height: 2.4rem;
  padding-inline: 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  transition:
    border-color var(--duration) var(--ease),
    color var(--duration) var(--ease);
}

.step:hover,
.jump:hover {
  border-color: var(--accent-line);
  color: var(--text-strong);
}

.jump.on {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 620;
}

.explain {
  margin-block-start: var(--space-5);
  padding-block-start: var(--space-4);
  border-block-start: 1px solid var(--border-soft);
}

.explain-line {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr);
  gap: var(--space-3);
  align-items: baseline;
  margin: 0 0 var(--space-3);
}

.explain-kind {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
}

.explain-line code {
  font-size: var(--text-xs);
  background: var(--bg-mute);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.5rem;
  direction: ltr;
  text-align: start;
}

.explain-line code.catalog {
  white-space: pre-wrap;
  line-height: 1.6;
}

.forms {
  margin: 0;
  font-size: var(--text-base);
  color: var(--accent);
}

.plural-note {
  margin-block: var(--space-4) 0;
  font-size: var(--text-base);
  color: var(--text-soft);
}

@media (max-width: 40rem) {
  .explain-line {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-1);
  }
}
</style>
