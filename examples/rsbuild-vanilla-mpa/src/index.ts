import "./index.css";
import { zintl } from "zintljs/macro";
import { Header } from "./components/Header.ts";
import { localeBar, setupSwitcher } from "./switcher.ts";

/**
 * The home page's entry — one of two, each with its own HTML document.
 *
 * An Rsbuild template names no scripts; the association between `index.html`
 * and this file lives in `rsbuild.config.mjs`, and Zintl reads it from there
 * (ledger L-021). This app is the first to exercise that with **more than one**
 * entry, which is the case `declareHtmlEntriesHook` and `entriesFor` were
 * written for and nothing had run.
 */
async function render() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);

  const rootEl = document.querySelector<HTMLDivElement>("#root");
  if (!rootEl) return;

  const page = document.createElement("div");
  page.className = "content";
  page.innerHTML = `
    <h1>Vanilla Rsbuild</h1>
    <p>Start building amazing things with Rsbuild.</p>
    <p>Two documents, two entries, one shared header.</p>
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
