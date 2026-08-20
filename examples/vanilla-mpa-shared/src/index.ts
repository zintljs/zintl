import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { zintl } from "zintljs/macro";
import { Header } from "./components/Header.ts";
import { localeBar, setupSwitcher } from "./switcher.ts";
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

  const appRoot = document.querySelector<HTMLDivElement>("#app")!;
  appRoot.innerHTML = `
    ${localeBar()}

    <section id="center">
      <div class="hero">
        <img src="${heroImg}" class="base" width="170" height="179">
        <img src="${typescriptLogo}" class="framework" alt="TypeScript logo"/>
        <img src="${viteLogo}" class="vite" alt="Vite logo" />
      </div>
      <div id="nav-container"></div>
      <div>
        <h1>Welcome to Zintl MPA Home</h1>
        <p>This is the homepage of our multi-page application example.</p>
      </div>
      <a href="/about?lang=${lang}" class="counter">Go to About Page</a>
    </section>

    <div class="ticks"></div>
    <section id="spacer"></section>
  `;

  // Inject shared Header
  const headerElem = await Header(lang);
  document.querySelector("#nav-container")!.appendChild(headerElem);

  setupSwitcher(document.querySelector<HTMLDivElement>("#switcher")!, (newLang) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    void render();
  });
}

void render();
