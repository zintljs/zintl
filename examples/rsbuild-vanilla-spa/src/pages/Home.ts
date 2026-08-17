/**
 * The strings reach Zintl because they are assigned to `innerHTML`.
 *
 * That is not incidental. Extraction stitches *HTML* out of template literals,
 * and it knows a template literal is HTML from where it is written to — an
 * assignment sink like `innerHTML`. A bare `return \`<h1>…\`` is just a string
 * as far as the extractor can tell, and is left alone. Same rule on both hosts.
 */
export function Home(): HTMLElement {
  const container = document.createElement("div");
  container.className = "content";

  container.innerHTML = `
    <h1>Vanilla Rsbuild</h1>
    <p>Start building amazing things with Rsbuild.</p>
    <p>Edit <code>src/pages/Home.ts</code> and save to test <code>HMR</code></p>
    <nav class="nav"><a id="to-about" href="/about" data-link>Read the guide</a></nav>
  `;

  return container;
}
