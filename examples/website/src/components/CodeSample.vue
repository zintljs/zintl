<!--
  A highlighted code sample.

  The code itself arrives as a prop from a script constant rather than as
  markup, which keeps it out of extraction's way: a plain JavaScript string
  reaches no sink, so nothing here needs an `@zintl-ignore` to stay in English.
  Code is not prose and should not appear in a translator's catalog.

  Note the wording above avoids naming the opening script tag literally. The
  SFC block matcher looks for that tag with a regex, and a comment that spells
  it out is indistinguishable from the real one — it matched here, took this
  prose for the script body, and reported a parse error thirty lines from the
  text that caused it.
-->
<script setup lang="ts">
import { computed } from "vue";
import { highlight } from "../lib/highlight";

const props = defineProps<{
  code: string;
  language?: string;
  /** Shown above the sample, the way a filename sits above a snippet. */
  label?: string;
}>();

const rendered = computed(() => highlight(props.code.trim(), props.language));
</script>

<template>
  <div class="sample">
    <p v-if="label" class="sample-label">{{ label }}</p>
    <pre><code v-html="rendered"></code></pre>
  </div>
</template>

<style scoped>
.sample {
  /* Code reads left-to-right in every language. */
  direction: ltr;
  text-align: start;
}

.sample-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-soft);
  margin: 0 0 var(--space-2);
}

.sample pre {
  margin: 0;
  font-size: var(--text-sm);
}
</style>
