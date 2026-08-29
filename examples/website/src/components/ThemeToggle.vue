<script setup lang="ts">
import { onMounted, ref } from "vue";

type Theme = "light" | "dark";

const theme = ref<Theme>("light");

// The document already carries the answer: `index.html` reads localStorage
// before first paint, and `color-scheme` resolves the rest. Reading it back is
// cheaper than duplicating that logic, and cannot disagree with it.
onMounted(() => {
  const stored = document.documentElement.dataset.theme;
  theme.value =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
});

function toggle() {
  theme.value = theme.value === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme.value;
  try {
    localStorage.setItem("zintl-theme", theme.value);
  } catch {}
}
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-pressed="theme === 'dark'"
    aria-label="Switch between light and dark"
    @click="toggle"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      aria-hidden="true"
    >
      <template v-if="theme === 'dark'">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" stroke-linejoin="round" />
      </template>
      <template v-else>
        <circle cx="12" cy="12" r="4.2" />
        <path
          d="M12 2.6v2.2M12 19.2v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6"
          stroke-linecap="round"
        />
      </template>
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-soft);
  transition:
    color var(--duration) var(--ease),
    background var(--duration) var(--ease);
}

.theme-toggle:hover {
  color: var(--text-strong);
  background: var(--bg-mute);
}

.theme-toggle svg {
  width: 1.05rem;
  height: 1.05rem;
}
</style>
