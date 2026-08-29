<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";
import { getSections } from "../nav";
import LocaleSwitcher from "./LocaleSwitcher.vue";
import ThemeToggle from "./ThemeToggle.vue";
import ZintlMark from "./ZintlMark.vue";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

// A section's link goes to its first page, which is the only entry point a
// section has — there are no section index pages, deliberately: a page whose
// whole content is a list of the links beside it is a page nobody reads twice.
// Reading `locale` here is what makes the titles follow the locale: it is the
// computed's only reactive dependency, and `getSections()` re-runs the `_t`
// lookups every time it changes.
const sectionLinks = computed(() =>
  getSections().map((section) => ({
    id: section.id,
    title: section.title,
    href: `/${locale.value}/${section.id}/${section.pages[0].slug}`,
  })),
);

const activeSection = computed(() => route.params.section as string | undefined);
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <RouterLink :to="`/${locale}`" class="brand">
        <span class="brand-mark"><ZintlMark /></span>
        <!-- @zintl-ignore -->
        <span class="brand-name">Zintl</span>
      </RouterLink>

      <nav class="nav" aria-label="Documentation sections">
        <RouterLink
          v-for="link in sectionLinks"
          :key="link.id"
          :to="link.href"
          class="nav-link"
          :class="{ active: activeSection === link.id }"
        >
          {{ link.title }}
        </RouterLink>
      </nav>

      <div class="header-end">
        <LocaleSwitcher />
        <div class="divider" role="presentation"></div>
        <ThemeToggle />
        <a
          class="icon-link"
          href="https://github.com/zintljs/zintl"
          target="_blank"
          rel="noreferrer"
          aria-label="Zintl on GitHub"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
        </a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  inset-block-start: 0;
  z-index: 30;
  height: var(--header-height);
  background: var(--bg-overlay);
  backdrop-filter: blur(12px);
  border-block-end: 1px solid var(--border);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: 100%;
  max-width: var(--width-shell);
  margin-inline: auto;
  padding-inline: var(--space-5);
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  color: var(--text-strong);
  font-weight: 640;
  letter-spacing: -0.02em;
  flex-shrink: 0;
}

.brand-mark {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--accent);
}

.brand-name {
  font-size: var(--text-md);
}

.nav {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-inline-start: var(--space-3);
}

.nav-link {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text);
  padding-block: 0.35rem;
  border-block-end: 2px solid transparent;
}

.nav-link:hover,
.nav-link.active {
  color: var(--text-strong);
}

.nav-link.active {
  border-block-end-color: var(--accent);
}

.header-end {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.divider {
  width: 1px;
  height: 1.25rem;
  background: var(--border);
}

.icon-link {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-full);
  color: var(--text-soft);
  transition:
    color var(--duration) var(--ease),
    background var(--duration) var(--ease);
}

.icon-link:hover {
  color: var(--text-strong);
  background: var(--bg-mute);
}

.icon-link svg {
  width: 1.05rem;
  height: 1.05rem;
}

@media (max-width: 60rem) {
  .nav {
    display: none;
  }
}

@media (max-width: 34rem) {
  .brand-name {
    display: none;
  }

  .header-inner {
    padding-inline: var(--space-4);
  }
}
</style>
