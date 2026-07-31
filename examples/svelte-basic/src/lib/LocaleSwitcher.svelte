<script lang="ts">
  import { zintl } from "zintljs/macro";

  interface Props {
    lang: string;
    onswitch: (lang: string) => void;
  }

  let { lang, onswitch }: Props = $props();

  const locales = [
    { id: "en", name: "English" },
    { id: "ar", name: "العربية" },
    { id: "es", name: "Español" },
    { id: "zh", name: "中文" },
  ];

  const handleSwitch = async (newLang: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    await zintl(newLang);
    onswitch(newLang);
  };
</script>

<!-- @zintl-ignore -->
<section id="header">
  <div id="switcher" class="switcher">
    {#each locales as l}
      <button
        class={lang === l.id ? "active" : ""}
        onclick={() => handleSwitch(l.id)}
      >
        {l.name}
      </button>
    {/each}
  </div>
  <div class="vertical-ticks"></div>
  <div class="icon-border">
    <svg class="icon" role="img" aria-hidden="true">
      <use href="/icons.svg#translate-icon"></use>
    </svg>
  </div>
</section>
<div class="ticks"></div>
