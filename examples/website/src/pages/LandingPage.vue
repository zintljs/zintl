<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { localeFromPath } from "../locale";
import CodeSample from "../components/CodeSample.vue";

const route = useRoute();
const locale = computed(() => localeFromPath(route.path));

const INSTALL = "npm install -D zintljs";
const ENTRY_FILE = "src/main.ts";
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

/**
 * Every code sample on this page, as constants.
 *
 * In `<script>` rather than in the template on purpose: a plain string reaches
 * no extraction sink, so none of this needs an `@zintl-ignore` and none of it
 * can end up in a translator's catalog. Code is not prose.
 */
const WHOLE_API = `import { zintl } from "zintljs/macro";

await zintl(userLocale);

document.querySelector("#app").innerHTML = \`<h1>Welcome back!</h1>\`;`;

const ELSEWHERE = `<h1>{t("home.welcome.title")}</h1>
<p>{t("home.welcome.body", { name: user.name })}</p>

// en.json
{ "home.welcome.title": "Welcome back!" }`;

const HERE = `<h1>Welcome back!</h1>
<p>Good to see you again, {user.name}.</p>`;

const HOSTS = [
  {
    id: "vite",
    name: "Vite",
    versions: "6 / 7 / 8",
    shapes: "SPA · MPA · SSR · per-locale static",
    status: "supported",
  },
  {
    id: "rsbuild",
    name: "Rsbuild",
    versions: "2.x",
    shapes: "SPA · MPA",
    status: "supported",
  },
  {
    id: "vinext",
    name: "Next.js via vinext",
    versions: "App Router, RSC",
    shapes: "SSR",
    status: "experimental",
  },
];

const FRAMEWORKS = ["React", "Preact", "Solid", "Vue", "Svelte", "Lit", "vanilla"];
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

  <section class="band">
    <div class="band-inner narrow">
      <h2>The whole API</h2>
      <p class="band-lede">
        That is not an excerpt. There is no wrapper to put the heading in, no key to invent for it,
        and no dictionary to keep in sync.
      </p>
      <CodeSample :code="WHOLE_API" language="ts" :label="ENTRY_FILE" />
    </div>
  </section>

  <section class="band alt">
    <div class="band-inner">
      <h2>The difference is the source</h2>
      <p class="band-lede">
        Both of these ship the same three languages. Only one of them is still readable a year from
        now.
      </p>

      <div class="compare">
        <div class="pane">
          <p class="pane-kind">Everywhere else</p>
          <CodeSample :code="ELSEWHERE" language="tsx" />
        </div>
        <div class="pane accent">
          <p class="pane-kind">Here</p>
          <CodeSample :code="HERE" language="tsx" />
        </div>
      </div>

      <p class="band-note">
        The keys still exist — the compiler mints them from the text and keeps them attached to it.
        You just never have to name one, or find the one you named last spring.
      </p>
    </div>
  </section>

  <section class="band">
    <div class="band-inner narrow">
      <h2>Your language is never written down</h2>
      <p class="band-lede">
        Zintl writes a catalog for every language you translate into, and none for the one you wrote
        in. A file of keys mapped to themselves is a maintenance burden pretending to be data.
      </p>

      <!--
        A file tree rather than a screenshot: it stays legible at any size, it
        can be read by a screen reader, and it cannot go stale against a build.
      -->
      <ul class="tree" role="list">
        <!-- @zintl-ignore -->
        <li class="dir">zintl/</li>
        <!-- @zintl-ignore -->
        <li class="file">App.vue.ar.json</li>
        <!-- @zintl-ignore -->
        <li class="file">App.vue.es.json</li>
        <!-- @zintl-ignore -->
        <li class="file">App.vue.zh.json</li>
        <li class="file absent">
          <!-- @zintl-ignore -->
          <span class="struck">App.vue.en.json</span>
          <span class="absent-note">never written</span>
        </li>
      </ul>

      <p class="band-note">
        The compiler already holds those strings — it read them out of your source. Nothing is lost
        and nothing is shipped twice.
      </p>
    </div>
  </section>

  <section class="band alt">
    <div class="band-inner">
      <h2>Where it runs</h2>
      <p class="band-lede">
        Zintl needs a plugin seat in the bundler that owns your chunk graph. That is the whole of
        what decides this list.
      </p>

      <div class="hosts">
        <article v-for="host in HOSTS" :key="host.id" class="host" :class="host.status">
          <!-- @zintl-ignore -->
          <h3>{{ host.name }}</h3>
          <!-- @zintl-ignore -->
          <p class="host-versions">{{ host.versions }}</p>
          <!-- @zintl-ignore -->
          <p class="host-shapes">{{ host.shapes }}</p>
          <p v-if="host.status === 'experimental'" class="host-status">Experimental</p>
          <p v-else class="host-status">Supported</p>
        </article>
      </div>

      <p class="frameworks">
        <span class="frameworks-kind">Frameworks</span>
        <!-- @zintl-ignore -->
        <span class="frameworks-list">{{ FRAMEWORKS.join(" · ") }}</span>
      </p>

      <p class="band-note">
        Every host but the last is driven end to end by the contract suite: real browsers against
        real apps, on every change. What is missing is listed too:
        <!--
          A **static** href, with no locale in it.

          This anchor sits inside a translatable sentence, so the compiler keeps
          the whole thing as one key and hands the markup back through `v-html`
          — where Vue never compiles anything. A `:href` binding here survives
          into the DOM as a literal attribute named `:href`, and the link goes
          nowhere. The locale is added when the link is followed, by the same
          rule the Markdown renderer uses for its own internal links.
        -->
        <a href="/reference/integrations">Integrations</a> names the hosts Zintl refuses rather than
        the ones it merely hasn't reached.
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

/* — Bands ————————————————————————————————————————————————— */

.band {
  padding-block: var(--space-9);
  border-block-start: 1px solid var(--border);
}

.band.alt {
  background: var(--bg-soft);
}

.band-inner {
  max-width: var(--width-shell);
  margin-inline: auto;
  padding-inline: var(--space-5);
}

.band-inner.narrow {
  max-width: 52rem;
}

.band h2 {
  font-size: var(--text-xl);
  margin-block: 0 var(--space-3);
}

.band-lede {
  font-size: var(--text-md);
  color: var(--text);
  max-width: 44rem;
  margin-block-end: var(--space-6);
}

.band-note {
  margin-block-start: var(--space-5);
  font-size: var(--text-base);
  color: var(--text-soft);
  max-width: 44rem;
  margin-block-end: 0;
}

/* — Before and after ——————————————————————————————————————— */

.compare {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: var(--space-4);
}

.pane {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.pane.accent {
  border-color: var(--accent-line);
}

.pane-kind {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
  margin-block-end: var(--space-3);
}

.pane.accent .pane-kind {
  color: var(--accent);
}

/* — Ghost mode ————————————————————————————————————————————— */

.tree {
  list-style: none;
  margin: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-code);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  direction: ltr;
  text-align: start;
}

.tree .dir {
  color: var(--text-strong);
  margin-block-end: var(--space-2);
}

.tree .file {
  padding-inline-start: var(--space-4);
  color: var(--text);
  line-height: 1.9;
}

.tree .absent {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  color: var(--text-soft);
}

.struck {
  text-decoration: line-through;
  text-decoration-color: var(--accent);
  text-decoration-thickness: 1.5px;
}

.absent-note {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}

/* — Where it runs —————————————————————————————————————————— */

.hosts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--space-4);
}

.host {
  padding: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.host h3 {
  font-size: var(--text-md);
  margin: 0 0 var(--space-1);
}

.host-versions {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-soft);
  margin-block-end: var(--space-3);
}

.host-shapes {
  font-size: var(--text-base);
  color: var(--text);
  margin-block-end: var(--space-3);
}

.host-status {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--accent-soft);
  color: var(--accent);
  margin: 0;
}

.host.experimental .host-status {
  background: var(--bg-mute);
  color: var(--text-soft);
}

.frameworks {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  margin-block-start: var(--space-5);
  margin-block-end: 0;
}

.frameworks-kind {
  font-size: var(--text-xs);
  font-weight: 620;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-soft);
}

.frameworks-list {
  font-size: var(--text-base);
  color: var(--text-strong);
}
</style>
