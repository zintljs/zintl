<script setup lang="ts">
import { zintl } from "zintljs/macro";

const props = defineProps<{
  lang: string;
}>();

const locales = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

const emit = defineEmits(["switch"]);

const handleSwitch = async (lang: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", lang);
  window.history.pushState({}, "", url.pathname + url.search);
  await zintl(lang);
  emit("switch", lang);
};
</script>

<template>
  <section id="header">
    <div id="switcher" class="switcher">
      <button
        v-for="l in locales"
        :key="l.id"
        :class="{ active: props.lang === l.id }"
        @click="handleSwitch(l.id)"
      >
        {{ l.name }}
      </button>
    </div>
    <div class="vertical-ticks"></div>
    <div class="icon-border">
      <svg class="icon" role="img" aria-hidden="true">
        <use href="/icons.svg#translate-icon"></use>
      </svg>
    </div>
  </section>
  <div class="ticks"></div>
</template>
