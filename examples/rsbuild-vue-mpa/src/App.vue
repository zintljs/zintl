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
      <h1>Rsbuild with Vue</h1>
      <p>Start building amazing things with Rsbuild.</p>
      <p>Two documents, two entries, one shared header.</p>
    </div>
  </div>
</template>
