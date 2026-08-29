<!--
  What this page actually cost, read from the browser rather than asserted.

  Every other section on this page describes Zintl. This one measures the page
  the description is printed on, which is the only claim here that cannot be
  written optimistically and left to rot.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

interface Measurement {
  catalogs: number;
  bytes: number;
}

/**
 * Whether a measurement is possible at all, which is a different question from
 * what it says.
 *
 * A dev server hands catalogs over as virtual modules, and a virtual module has
 * no resource timing — so in dev there is nothing to read and the panel says so.
 * In a build there always is, and **zero is a real answer**: on the source
 * language ghost mode means no catalog was ever fetched, which is the most
 * interesting reading this panel has. Treating an empty result as "cannot
 * measure" hid exactly the case worth showing.
 *
 * `import.meta.env.DEV` is folded to a constant at build time, so the dev branch
 * is not shipped.
 */
const canMeasure = !import.meta.env.DEV;
const measured = ref<Measurement | null>(null);

onMounted(() => {
  if (!canMeasure || typeof performance?.getEntriesByType !== "function") return;

  const entries = performance
    .getEntriesByType("resource")
    .filter((entry): entry is PerformanceResourceTiming =>
      /\/assets\/entry_b_[^/]*\.js$/.test(entry.name),
    );

  // `transferSize` is 0 for a cached response and for a cross-origin one
  // without Timing-Allow-Origin; `encodedBodySize` still reports the wire size.
  const bytes = entries.reduce(
    (total, entry) => total + (entry.transferSize || entry.encodedBodySize || 0),
    0,
  );

  measured.value = { catalogs: entries.length, bytes };
});

const kilobytes = computed(() => (measured.value ? (measured.value.bytes / 1024).toFixed(1) : ""));
</script>

<template>
  <div class="meta">
    <p class="meta-kind">This page</p>

    <template v-if="measured && measured.catalogs > 0">
      <p class="headline">
        This page downloaded <span class="figure">{{ kilobytes }} KB</span> of translations.
      </p>

      <dl class="readings">
        <div class="reading">
          <dt>Active language</dt>
          <!-- @zintl-ignore -->
          <dd>{{ locale }}</dd>
        </div>
        <div class="reading">
          <dt>Catalog chunks fetched</dt>
          <!-- @zintl-ignore -->
          <dd>{{ measured.catalogs }}</dd>
        </div>
        <div class="reading">
          <dt>Languages you are not reading</dt>
          <dd>None of them</dd>
        </div>
      </dl>

      <p class="meta-note">
        Measured in your browser with the Resource Timing API, not written down here in advance. The
        other three languages this site is published in were built, and none of them was sent to
        you.
      </p>
    </template>

    <template v-else-if="measured">
      <p class="headline">
        You are reading the source language, so no catalog was downloaded at all.
      </p>
      <p class="meta-note">
        Zintl never writes your own language to disk — the compiler already holds those strings. The
        other three this site is published in were built, and none of them was sent to you.
      </p>
    </template>

    <template v-else>
      <p class="headline">The measurement is only meaningful in a build.</p>
      <p class="meta-note">
        A dev server hands catalogs over as virtual modules, which have no resource timing to read —
        so rather than print a confident zero, this panel says nothing. Open the published site and
        it will show you what that page cost.
      </p>
    </template>
  </div>
</template>

<style scoped>
.meta {
  border: 1px solid var(--accent-line);
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
  padding: var(--space-6);
}

.meta-kind {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--accent);
  margin: 0 0 var(--space-3);
}

.headline {
  font-size: var(--text-lg);
  font-weight: 560;
  color: var(--text-strong);
  margin: 0 0 var(--space-5);
  text-wrap: balance;
}

.figure {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.readings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-4);
  margin: 0 0 var(--space-5);
}

.reading dt {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-soft);
  margin-block-end: var(--space-1);
}

.reading dd {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 560;
  color: var(--text-strong);
}

.meta-note {
  margin: 0;
  font-size: var(--text-base);
  color: var(--text-soft);
  max-width: 44rem;
}
</style>
