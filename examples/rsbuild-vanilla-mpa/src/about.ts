import "./index.css";
import { zintl } from "zintljs/macro";
import { Header } from "./components/Header.ts";
import { localeBar, setupSwitcher } from "./switcher.ts";

/**
 * The second page's entry, with its own document and its own trust anchor.
 *
 * Its boundary is independent of the home page's — nothing is inherited across
 * documents — while `Header`'s boundary is shared by both, because both import
 * it and it anchors itself.
 */
async function render() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);

  const rootEl = document.querySelector<HTMLDivElement>("#root");
  if (!rootEl) return;

  const page = document.createElement("div");
  page.className = "content";
  page.innerHTML = `
    <h1>Everything is a plain string</h1>
    <p>This document has its own entry, and its own catalog chunk.</p>
    <p>The header above is shared, and anchors itself.</p>
  `;

  rootEl.innerHTML = localeBar();
  rootEl.append(await Header(lang), page);

  setupSwitcher(rootEl.querySelector<HTMLDivElement>("#switcher")!, (newLang) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    void render();
  });
}

void render();
