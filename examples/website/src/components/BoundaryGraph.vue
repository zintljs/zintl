<!--
  The boundary graph, as three columns you can point at.

  Rows rather than a drawn graph with curves: a row survives being narrow, reads
  in either direction without redrawing its arrows, and can be tabbed through.
  What it has to communicate is *which things travel together*, and adjacency
  says that as well as a line does.
-->
<script setup lang="ts">
import { ref } from "vue";

/**
 * Structure only. Every word a reader sees is markup in the template below, so
 * it reaches a catalog; the file names here are file names in every language.
 */
const ROUTES = [
  { id: "home", files: ["src/main.ts", "Header.vue", "Nav.vue"], chunk: "entry" },
  { id: "settings", files: ["src/settings.ts", "Charts.vue"], chunk: "lazy" },
];

const active = ref<string | null>(null);
</script>

<template>
  <div class="graph">
    <div class="columns" aria-hidden="true">
      <p class="column-head">What you wrote</p>
      <p class="column-head">What it becomes</p>
      <p class="column-head">What the browser loads</p>
    </div>

    <ul class="rows" role="list">
      <li
        v-for="route in ROUTES"
        :key="route.id"
        class="row"
        :class="{ active: active === route.id, dim: active !== null && active !== route.id }"
        tabindex="0"
        @mouseenter="active = route.id"
        @mouseleave="active = null"
        @focus="active = route.id"
        @blur="active = null"
      >
        <div class="cell files">
          <!-- @zintl-ignore -->
          <code v-for="file in route.files" :key="file" class="file">{{ file }}</code>
        </div>

        <div class="cell boundary">
          <span class="pill">
            <template v-if="route.id === 'home'">The home boundary</template>
            <template v-else>The settings boundary</template>
          </span>
          <p class="cell-note">
            <template v-if="route.id === 'home'">
              Everything the first screen can reach from its anchor.
            </template>
            <template v-else>Everything reachable from the anchor in that route.</template>
          </p>
        </div>

        <div class="cell chunk">
          <span class="pill catalog">
            <template v-if="route.chunk === 'entry'">Arrives with the page</template>
            <template v-else>Arrives with the route</template>
          </span>
          <p class="cell-note">
            <template v-if="route.chunk === 'entry'">
              One catalog, in the reader's language only.
            </template>
            <template v-else>Nothing until somebody opens settings.</template>
          </p>
        </div>
      </li>
    </ul>

    <p class="graph-note">
      Two anchors, two boundaries, two catalogs. Someone who never opens settings never downloads
      its translations — the split is the one your bundler already made, not a second one to
      maintain.
    </p>
  </div>
</template>

<style scoped>
.graph {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
  padding: var(--space-5);
}

.columns {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr;
  gap: var(--space-4);
  margin-block-end: var(--space-3);
}

.column-head {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
  margin: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.row {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
  transition:
    border-color var(--duration) var(--ease),
    opacity var(--duration) var(--ease);
}

.row.active {
  border-color: var(--accent-line);
}

/* Dimming the others is what makes this a graph rather than a table: it shows
   that the two rows share nothing. */
.row.dim {
  opacity: 0.4;
}

.cell {
  min-width: 0;
}

.files {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: start;
}

.file {
  font-size: var(--text-xs);
  background: var(--bg-mute);
  border-radius: var(--radius-sm);
  padding: 0.1rem 0.4rem;
  direction: ltr;
}

.pill {
  display: inline-block;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-strong);
}

.pill.catalog {
  color: var(--accent);
}

.cell-note {
  font-size: var(--text-xs);
  color: var(--text-soft);
  margin: var(--space-1) 0 0;
  line-height: 1.5;
}

.graph-note {
  margin-block: var(--space-4) 0;
  font-size: var(--text-base);
  color: var(--text-soft);
}

@media (max-width: 50rem) {
  .columns {
    display: none;
  }

  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
}
</style>
