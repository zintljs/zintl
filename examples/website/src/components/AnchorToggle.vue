<!--
  What the anchor's argument decides, as a switch.

  The two columns of `docs/architecture.md`'s table, except you flip between
  them — which is closer to how the decision actually feels, since it is one
  character of difference in the source and a different application out.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import CodeSample from "./CodeSample.vue";

const literal = ref(false);

const VARIABLE_CODE = `await zintl(locale);`;
const LITERAL_CODE = `await zintl("fr");`;

const code = computed(() => (literal.value ? LITERAL_CODE : VARIABLE_CODE));
</script>

<template>
  <div class="toggle">
    <div class="switch" role="group">
      <button
        type="button"
        :class="{ on: !literal }"
        :aria-pressed="!literal"
        @click="literal = false"
      >
        A variable
      </button>
      <button
        type="button"
        :class="{ on: literal }"
        :aria-pressed="literal"
        @click="literal = true"
      >
        A literal
      </button>
    </div>

    <CodeSample :code="code" language="ts" />

    <dl class="outcome">
      <div class="fact">
        <dt>Catalog chunk emitted</dt>
        <dd>
          <template v-if="literal">None</template>
          <template v-else>One per language</template>
        </dd>
      </div>
      <div class="fact">
        <dt>Other languages built</dt>
        <dd>
          <template v-if="literal">No</template>
          <template v-else>Yes</template>
        </dd>
      </div>
      <div class="fact" :class="{ highlight: literal }">
        <dt>Your own language in the bundle</dt>
        <dd>
          <template v-if="literal">Absent</template>
          <template v-else>Present</template>
        </dd>
      </div>
    </dl>

    <p class="reading">
      <template v-if="literal">
        A literal is a promise the compiler can keep. It bakes French in and stops treating the
        other languages as reachable — so there is nothing left to load, and your English is not in
        the output at all. The page does not fall back to English; English was never built.
      </template>
      <template v-else>
        A variable says the language is still undecided, so every one is built and switchable. This
        is what you want the moment a reader can change language, or it comes from a URL, a cookie
        or a header.
      </template>
    </p>
  </div>
</template>

<style scoped>
.toggle {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg);
  padding: var(--space-5);
}

.switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-mute);
  border-radius: var(--radius-full);
  margin-block-end: var(--space-4);
}

.switch button {
  padding: 0.3rem 0.9rem;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-soft);
  transition:
    background var(--duration) var(--ease),
    color var(--duration) var(--ease);
}

.switch button.on {
  background: var(--bg);
  color: var(--text-strong);
  box-shadow: var(--shadow-sm);
}

.outcome {
  margin: var(--space-5) 0 0;
  display: grid;
  gap: var(--space-2);
}

.fact {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding-block: var(--space-2);
  border-block-end: 1px solid var(--border-soft);
}

.fact dt {
  font-size: var(--text-base);
  color: var(--text);
}

.fact dd {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 560;
  color: var(--text-strong);
  white-space: nowrap;
}

/* The third row is the one that surprises people, so it is allowed to shout. */
.fact.highlight dd {
  color: var(--accent);
}

.reading {
  margin-block: var(--space-4) 0;
  font-size: var(--text-base);
  color: var(--text-soft);
  min-height: 4.5rem;
}
</style>
