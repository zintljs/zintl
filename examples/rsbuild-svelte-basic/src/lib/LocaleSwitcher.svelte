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
<div id="switcher" class="switcher">
  {#each locales as l (l.id)}
    <button type="button" class={lang === l.id ? "active" : ""} onclick={() => handleSwitch(l.id)}>
      {l.name}
    </button>
  {/each}
</div>

<style>
  /* Logical properties throughout, because `<html dir>` is what Zintl projects
   * per locale: the Arabic build flips the document and nothing here should need
   * a second rule to follow it. */
  .switcher {
    position: fixed;
    inset-block-start: 0;
    inset-inline: 0;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
    padding: 1rem;
  }

  .switcher button {
    font: inherit;
    font-size: 0.95rem;
    line-height: 1.2;
    color: #fff;
    cursor: pointer;
    padding: 0.4rem 0.9rem;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 999px;
    background: rgb(255 255 255 / 6%);
  }

  .switcher button:hover {
    background: rgb(255 255 255 / 12%);
  }

  .switcher button.active {
    border-color: rgb(255 255 255 / 45%);
    background: rgb(255 255 255 / 18%);
  }
</style>
