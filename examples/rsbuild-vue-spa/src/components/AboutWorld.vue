<script setup lang="ts">
 /**
 * Reached only through `() => import(...)` in `src/router.ts`, which is the
 * point of this example.
 *
 * These strings belong to a boundary the entry never imports statically, so
 * Zintl emits their catalog behind the same dynamic import Rspack uses for the
 * component. Nothing here is written differently because of that.
 */
</script>

<template>
  <div class="content">
    <h1>Everything is a plain string</h1>
    <p>This route arrived in its own chunk, and so did its translations.</p>
    <p>No <code>t()</code> wrapper, no key dictionary, no manual catalog.</p>
    <nav class="nav"><router-link id="to-home" to="/">Back to the start</router-link></nav>
  </div>
</template>
