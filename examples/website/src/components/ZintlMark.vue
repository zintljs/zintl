<!--
  The Zintl mark, inline rather than fetched: one less request, and the same
  gradient `public/favicon.svg` carries, so the tab icon and the header logo are
  the same object rather than two drawings that resemble each other.

  It does **not** take `currentColor`. The gradient is the brand, and a brand
  that changes colour with the surrounding text is a decoration instead — the
  coral→pink→violet run reads on both the light and the dark background, which
  is the reason it can be a constant here.

  `aria-hidden` is deliberate. Labelling it would put the brand name into every
  catalog in every locale, which is precisely what a brand name is not.
-->
<template>
  <svg class="zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
    <defs>
      <linearGradient
        :id="gradientId"
        x1="10"
        y1="92"
        x2="92"
        y2="16"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#f4795e" />
        <stop offset=".55" stop-color="#e8309c" />
        <stop offset="1" stop-color="#b44be0" />
      </linearGradient>
      <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="#000" />
        <g
          stroke="#fff"
          stroke-width="13"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        >
          <path d="M16 45V84" />
          <path d="M16 24v1" />
          <path d="M62 84V50" />
          <path d="M62 60a14 14 0 0 1 28 0v24" />
        </g>
        <circle cx="39" cy="52" r="21.5" fill="#000" />
        <circle cx="39" cy="74" r="23" fill="#000" />
        <circle cx="39" cy="52" r="17.5" fill="#fff" />
        <circle cx="39" cy="73" r="19" fill="#fff" />
        <circle cx="39" cy="52" r="5" fill="#000" />
        <circle cx="39" cy="74" r="6.5" fill="#000" />
      </mask>
    </defs>
    <rect width="100" height="100" :fill="`url(#${gradientId})`" :mask="`url(#${maskId})`" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from "vue";

// Both ids have to be unique per document, and the mark renders more than once
// on a page. `useId` is stable across SSR and hydration, which a counter is not.
const id = useId();
const maskId = `zintl-mark-${id}`;
const gradientId = `zintl-grad-${id}`;
</script>

<style scoped>
.zintl-mark {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
