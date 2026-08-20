<!--
  The Zintl locale bar — the one piece of UI every example shares.

  Same markup, same class names and same behaviour on every framework and both
  hosts, so a difference you notice between two examples is a difference in
  *Zintl* rather than in their chrome. The vanilla, React and Vue examples render
  this exact DOM from their own dialect; see `docs/examples-locale-bar.md`.
-->
<script lang="ts">
  interface Props {
    lang: string;
  }

  let { lang }: Props = $props();

  const locales = [
    { id: "en", name: "English" },
    { id: "ar", name: "العربية" },
    { id: "es", name: "Español" },
    { id: "zh", name: "中文" },
  ];

  /**
   * A switch here is a navigation, not a catalog swap: this app is multiplexed,
   * so every locale is served as its own document under `/<locale>/`. The
   * runtime-switching examples call `zintl(lang)` and repaint in place instead.
   */
  const handleSwitch = (next: string) => {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/^\/(?:en|ar|es|zh)/, "") || "/";
    url.pathname = `/${next}${path === "/" ? "/" : path}`;
    window.history.pushState({}, "", url.pathname + url.search);
    location.reload();
  };
</script>

<!-- @zintl-ignore -->
<section id="header">
  <div id="switcher" class="switcher">
    {#each locales as l (l.id)}
      <button
        type="button"
        data-lang={l.id}
        class={lang === l.id ? "active" : ""}
        aria-current={lang === l.id ? "true" : undefined}
        onclick={() => handleSwitch(l.id)}
      >
        {l.name}
      </button>
    {/each}
  </div>
  <div class="vertical-ticks"></div>
  <div class="icon-border">
    <!--
      The Zintl mark, inline rather than fetched. Inline is the only form that is
      identical on both hosts: it needs no `public/` directory (the Rsbuild
      starters have none) and no second request. It is drawn in `currentColor` so
      it follows the bar into light or dark without a filter, and it is
      `aria-hidden` — labelling it would put the brand name into every catalog in
      every locale, which is precisely what it is not.
    -->
    <svg class="icon zintl-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <mask id="zintl-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" />
        <g stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M16 45V84" />
          <path d="M16 24v1" />
          <path d="M62 84V50" />
          <path d="M62 60a14 14 0 0 1 28 0v24" />
        </g>
        <circle cx="39" cy="52" r="21.5" />
        <circle cx="39" cy="74" r="23" />
        <circle cx="39" cy="52" r="17.5" fill="#fff" />
        <circle cx="39" cy="73" r="19" fill="#fff" />
        <circle cx="39" cy="52" r="5" />
        <circle cx="39" cy="74" r="6.5" />
      </mask>
      <rect width="100" height="100" fill="currentColor" mask="url(#zintl-mark-mask)" />
    </svg>
  </div>
</section>
<div class="ticks"></div>
