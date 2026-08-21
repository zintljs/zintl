<script lang="ts">
  import LocaleSwitcher from "./lib/LocaleSwitcher.svelte";

  let activeLang = $state(new URLSearchParams(window.location.search).get("lang") || "en");
  let count = $state(0);

  const handleSwitch = (lang: string) => {
    // Reassigning is what remounts the tree through `{#key}`. The catalog has
    // already been swapped by the switcher's own `await zintl(lang)`.
    activeLang = lang;
  };

  /**
   * A named handler, not `onclick={() => count++}` inline, and the reason is a
   * live extractor defect rather than style: an inline arrow in an event
   * attribute on an element whose text content is extractable makes the stitched
   * unit start inside the attribute. The key comes out as
   * `"count++}>\n  Count is {count}"` and the generated Svelte no longer parses.
   * Reproduced on **both** hosts — `examples/svelte-basic` fails the same way
   * when its `onclick={increment}` is inlined — so it is Svelte handling in the
   * extractor, not anything about Rspack.
   */
  const increment = () => {
    count += 1;
  };
</script>

<LocaleSwitcher lang={activeLang} onswitch={handleSwitch} />

{#key activeLang}
  <main>
    <div class="content">
      <h1>Rsbuild with Svelte</h1>
      <p>Start building amazing things with Rsbuild.</p>
      <p>Edit <code>src/App.svelte</code> and save to test <code>HMR</code></p>
      <button id="counter" type="button" class="counter" onclick={increment}>
        Count is {count}
      </button>
    </div>
  </main>
{/key}

<style>
  /* `create-rsbuild`'s `template-svelte-ts/src/App.svelte` styles, plus what the
   * counter and the inline `<code>` need. */
  .content {
    display: flex;
    box-sizing: border-box;
    min-height: calc(100svh - 56px);
    padding-block: 2rem;
    line-height: 1.1;
    text-align: center;
    flex-direction: column;
    justify-content: center;
  }

  .content h1 {
    font-size: 3.6rem;
    font-weight: 700;
  }

  .content p {
    font-size: 1.2rem;
    font-weight: 400;
    opacity: 0.5;
  }

  /* `:global`, and this is the one Svelte-specific thing in the whole example.
   * A sentence with an inline tag is stitched into a single key, so the
   * `<code>` elements are rendered from the catalog through `{@html}` rather
   * than written in this template. Svelte's scoped-CSS pass only sees the
   * markup it can statically attribute to this component, so a plain
   * `.content code` is reported as `css_unused_selector` and pruned. */
  .content :global(code) {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: rgb(255 255 255 / 10%);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }

  .counter {
    font: inherit;
    font-size: 1rem;
    color: #fff;
    cursor: pointer;
    align-self: center;
    margin-block-start: 1.5rem;
    padding: 0.55rem 1.4rem;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 8px;
    background: rgb(255 255 255 / 6%);
  }

  .counter:hover {
    background: rgb(255 255 255 / 12%);
  }
</style>
