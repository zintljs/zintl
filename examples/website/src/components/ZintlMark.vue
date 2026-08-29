<!--
  The Zintl mark, inline rather than fetched: one less request, and it inherits
  `currentColor` so it follows the header into light or dark with no filter.

  `aria-hidden` is deliberate. Labelling it would put the brand name into every
  catalog in every locale, which is precisely what a brand name is not.
-->
<template>
  <svg class="zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
    <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" />
      <g stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M16 45V84" />
        <path d="M16 24v1" />
        <path d="M62 84V50" />
        <path d="M62 60a14 14 0 0 1 28 0v24" />
      </g>
      <circle cx="39" cy="52" r="21.5" />
      <circle cx="39" cy="74" r="23" />
      <circle cx="39" cy="52" r="17.5" fill="#fff" />
      <circle cx="39" cy="73" r="19" fill="#fff" />
      <circle cx="39" cy="52" r="5" />
      <circle cx="39" cy="74" r="6.5" />
    </mask>
    <rect width="100" height="100" fill="currentColor" :mask="`url(#${maskId})`" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from "vue";

// A mask id has to be unique per document, and the mark renders more than once
// on a page. `useId` is stable across SSR and hydration, which a counter is not.
const maskId = `zintl-mark-${useId()}`;
</script>

<style scoped>
.zintl-mark {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
