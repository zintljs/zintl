<script setup lang="ts">
import { ref } from "vue";
import LocaleSwitcher from "./components/LocaleSwitcher.vue";
import SiteHeader from "./components/SiteHeader.vue";

const activeLang = ref(new URLSearchParams(window.location.search).get("lang") || "en");

const handleSwitch = (lang: string) => {
  activeLang.value = lang;
};
</script>

<template>
  <div :key="activeLang">
    <Suspense>
      <SiteHeader :lang="activeLang" />
    </Suspense>
    <div class="content">
      <LocaleSwitcher :lang="activeLang" @switch="handleSwitch" />
      <h1>Everything is a plain string</h1>
      <p>This document has its own entry, and its own catalog chunk.</p>
      <p>The header above is shared, and anchors itself.</p>
    </div>
  </div>
</template>
