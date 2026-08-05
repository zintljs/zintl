import { zintl } from "zintljs/macro";
import { setupCounter } from "./counter.ts";
import { setupSwitcher } from "./switcher.ts";
import aboutText from "./about.txt?raw";

async function render() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section id="header">
  <div id="switcher" class="switcher"></div>
</section>

<section id="center">
  <div>
    <h1>Get started</h1>
    <p>Edit <code>src/main.ts</code> and save to test <code>HMR</code></p>
  </div>
  <button id="counter" type="button" class="counter"></button>
</section>

<section id="next-steps">
  <div id="docs">
    <h2>Documentation</h2>
    <p>Your questions, answered</p>
    <p id="about">${aboutText}</p>
  </div>
</section>
`;

  setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
  setupSwitcher(document.querySelector<HTMLDivElement>("#switcher")!, (newLang) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    void render();
  });
}

void render();
