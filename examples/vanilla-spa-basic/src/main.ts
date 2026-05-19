import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { setupCounter } from "./counter.ts";
import { zintl } from "@zintl/vite/macro";
import { setupSwitcher } from "./switcher.ts";
import iconsSvg from "./assets/icons.svg?raw";

// Inject the sprite once to prevent reloads on innerHTML updates
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
    <h1>Get started</h1>
    <p>Edit <code>src/main.ts</code> and save to test <code>HMR</code></p>
  </div>
  <button id="counter" type="button" class="counter"></button>
</section>

<div class="ticks"></div>

<section id="next-steps">
  <div id="docs">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="#documentation-icon"></use></svg>
    <h2>Documentation</h2>
    <p>Your questions, answered</p>
    <ul>
      <li>
        <a href="https://vite.dev/" target="_blank">
          <img class="logo" src="${viteLogo}" alt="" />
          Explore Vite
        </a>
      </li>
      <li>
        <a href="https://www.typescriptlang.org" target="_blank">
          <img class="button-icon" src="${typescriptLogo}" alt="">
          Learn more
        </a>
      </li>
    </ul>
  </div>
  <div id="social">
    <svg class="icon" role="presentation" aria-hidden="true"><use href="#social-icon"></use></svg>
    <h2>Connect with us</h2>
    <p>Join the Vite community</p>
    <!-- @zintl-ignore -->
    <ul>
      <li><a href="https://github.com/vitejs/vite" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="#github-icon"></use></svg>GitHub</a></li>
      <li><a href="https://chat.vite.dev/" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="#discord-icon"></use></svg>Discord</a></li>
      <li><a href="https://x.com/vite_js" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="#x-icon"></use></svg>X.com</a></li>
      <li><a href="https://bsky.app/profile/vite.dev" target="_blank"><svg class="button-icon" role="presentation" aria-hidden="true"><use href="#bluesky-icon"></use></svg>Bluesky</a></li>
    </ul>
  </div>
</section>

<div class="ticks"></div>
<section id="spacer"></section>
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
