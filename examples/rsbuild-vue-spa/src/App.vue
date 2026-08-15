<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import LocaleSwitcher from "./components/LocaleSwitcher.vue";

const route = useRoute();
const router = useRouter();

const activeLang = ref(new URLSearchParams(window.location.search).get("lang") || "en");

// Follow browser back/forward, which can change `?lang` without the switcher
watch(
  () => route.query.lang,
  (newLang) => {
    if (typeof newLang === "string" && newLang) activeLang.value = newLang;
  },
);

const handleSwitch = (lang: string) => {
  activeLang.value = lang;
  void router.push({ path: route.path, query: { ...route.query, lang } });
};
</script>

<template>
  <div :key="activeLang">
    <LocaleSwitcher :lang="activeLang" @switch="handleSwitch" />
    <Suspense>
      <router-view />
    </Suspense>
  </div>
</template>
