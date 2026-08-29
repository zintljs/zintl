<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

const INSTALL = "npm install -D zintljs";
const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(INSTALL);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    // A clipboard the browser refuses is not an error worth showing; the
    // command is on screen and selectable, which is the fallback that matters.
  }
}
</script>

<template>
  <section class="hero">
    <div class="hero-inner">
      <p class="eyebrow">Compile-time internationalization</p>

      <h1 class="title">
        Write your app in <span class="plain">plain language</span>.<br />
        Ship it in <span class="every">every language</span>.
      </h1>

      <p class="lede">
        Most i18n libraries ask you to change how you write code — wrap every string in a function,
        invent a key for it, keep a dictionary in sync by hand. Zintl doesn't. You write normal
        strings; the compiler finds them, works out which ones each screen actually needs, and ships
        exactly those.
      </p>

      <div class="actions">
        <RouterLink :to="`/${locale}/guide/getting-started`" class="button primary">
          Get started
        </RouterLink>
        <RouterLink :to="`/${locale}/concepts/boundaries-and-chunks`" class="button ghost">
          How it works
        </RouterLink>

        <button type="button" class="install" @click="copyInstall">
          <!-- @zintl-ignore -->
          <code>{{ INSTALL }}</code>
          <!--
            Two elements rather than one ternary, so both words are *markup*
            text and reach extraction. `{{ copied ? "Copied" : "Copy" }}` is a
            JavaScript expression that happens to hold prose, and the extractor
            is right not to guess at it.
          -->
          <span v-if="copied" class="install-hint">Copied</span>
          <span v-else class="install-hint">Copy</span>
        </button>
      </div>

      <p class="switch-hint">
        Switch the language in the bar above. Nothing reloads, and nothing you are not reading was
        ever downloaded.
      </p>
    </div>
  </section>
</template>

<style scoped>
.hero {
  padding-block: clamp(var(--space-8), 12vh, var(--space-9));
  /* A wash rather than a block of colour: the gradient is the brand's, at an
     opacity where it reads as warmth behind the type instead of a banner. */
  background:
    radial-gradient(60rem 28rem at 50% -12rem, var(--accent-soft), transparent 70%), var(--bg);
}

.hero-inner {
  max-width: 52rem;
  margin-inline: auto;
  padding-inline: var(--space-5);
  text-align: center;
}

.eyebrow {
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--accent);
  margin-block-end: var(--space-4);
}

.title {
  font-size: clamp(var(--text-2xl), 6vw, var(--text-4xl));
  font-weight: 680;
  letter-spacing: -0.035em;
  line-height: 1.1;
  margin-block-end: var(--space-5);
}

/*
 * `:deep()`, and it is not optional — this is where Zintl's stitching meets
 * Vue's scoped styles.
 *
 * The headline is one translatable sentence that happens to contain two
 * `<span>`s, so the compiler keeps it as one key — `Write your app in
 * <span1>plain language</span1>…` — and hands the markup back through `v-html`.
 * Vue stamps its `data-v-*` attribute only on elements its own template
 * compiler emits, so these two spans arrive without one and a plain `.plain`
 * rule never matches them. `:deep()` drops the attribute from the subject and
 * puts it on the ancestor instead, which the `v-html` host does carry.
 *
 * The alternative is to break the sentence into three so every span is
 * template-emitted, and that is the trade this project exists to refuse:
 * translators would get three fragments to assemble in an order English chose.
 */
:deep(.plain) {
  color: var(--text-strong);
  text-decoration: underline;
  text-decoration-color: var(--accent-line);
  text-decoration-thickness: 2px;
  text-underline-offset: 6px;
}

:deep(.every) {
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lede {
  font-size: var(--text-lg);
  line-height: 1.65;
  color: var(--text);
  max-width: 40rem;
  margin-inline: auto;
  margin-block-end: var(--space-6);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}

.button {
  display: inline-flex;
  align-items: center;
  height: 2.75rem;
  padding-inline: var(--space-5);
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  font-weight: 560;
  transition:
    background var(--duration) var(--ease),
    border-color var(--duration) var(--ease),
    color var(--duration) var(--ease);
}

.button.primary {
  background: var(--accent);
  color: #fff;
}

.button.primary:hover {
  background: var(--accent-hover);
  color: #fff;
}

.button.ghost {
  border: 1px solid var(--border);
  color: var(--text-strong);
}

.button.ghost:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}

.install {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 2.75rem;
  padding-inline: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-code);
  /* A shell command reads the same in every language. */
  direction: ltr;
}

.install:hover {
  border-color: var(--accent-line);
}

.install code {
  color: var(--text-strong);
  font-size: var(--text-sm);
}

.install-hint {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-soft);
}

.switch-hint {
  margin-block-start: var(--space-6);
  font-size: var(--text-base);
  color: var(--text-soft);
}
</style>
