<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import LocaleSwitcher from "./components/LocaleSwitcher.vue";

const router = useRouter();
const route = useRoute();

const activeLang = ref(new URLSearchParams(window.location.search).get("lang") || "en");

// Watch for route query changes to update activeLang (e.g. on browser back/forward)
watch(
  () => route.query.lang,
  (newLang) => {
    if (newLang && typeof newLang === "string") {
      activeLang.value = newLang;
    }
  },
);

const handleSwitch = (lang: string) => {
  activeLang.value = lang;
  router.push({
    path: route.path,
    query: { ...route.query, lang },
  });
};
</script>

<template>
  <div :key="activeLang">
    <LocaleSwitcher @switch="handleSwitch" :lang="activeLang" />
    <Suspense>
      <router-view :lang="activeLang" />
    </Suspense>
  </div>
</template>
