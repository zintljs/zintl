/**
 * Reached only through `await import()`, which is the point.
 *
 * These strings belong to a boundary the entry never imports statically, so
 * Zintl emits their catalog behind the same dynamic import Rspack uses for the
 * page itself. Nothing here is written differently because of that.
 */
export function About(): HTMLElement {
  const container = document.createElement("div");
  container.className = "content";

  container.innerHTML = `
    <h1>Everything is a plain string</h1>
    <p>This page arrived in its own chunk, and so did its translations.</p>
    <p>No <code>t()</code> wrapper, no key dictionary, no manual catalog.</p>
    <nav class="nav"><a id="to-home" href="/" data-link>Back to the start</a></nav>
  `;

  return container;
}
