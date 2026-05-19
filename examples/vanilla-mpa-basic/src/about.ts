import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { zintl } from "zintl/macro";
import { setupSwitcher } from "./switcher.ts";
import iconsSvg from "./assets/icons.svg?raw";

// Inject sprite
const iconsDiv = document.createElement("div");
iconsDiv.id = "__icons__";
iconsDiv.style.display = "none";
iconsDiv.innerHTML = iconsSvg;
document.body.insertBefore(iconsDiv, document.body.firstChild);

async function render() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <section id="header">
      <div id="switcher" class="switcher"></div>
      <div class="vertical-ticks"></div>
      <div class="icon-border"><svg class="icon" role="img" aria-hidden="true"><use href="#translate-icon"></use></svg></div>
    </section>

    <div class="ticks"></div>

    <section id="center">
      <div class="hero">
        <img src="${heroImg}" class="base" width="170" height="179">
        <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
        <img src="${viteLogo}" class="vite" alt="Vite logo" />
      </div>
      <div>
        <h1>About Zintl MPA</h1>
        <p>This page demonstrates clean MPA routing and fully isolated hydration cycles.</p>
      </div>
      <a href="/index.html?lang=${lang}" class="counter">Go back Home</a>
    </section>

    <div class="ticks"></div>
    <section id="spacer"></section>
  `;

  setupSwitcher(document.querySelector<HTMLDivElement>("#switcher")!, (newLang) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    void render();
  });
}

void render();
