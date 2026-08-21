import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { zintl } from "zintljs/macro";
import { currentRoute, localeBar } from "./switcher.ts";
import iconsSvg from "./assets/icons.svg?raw";

const iconsDiv = document.createElement("div");
iconsDiv.id = "__icons__";
iconsDiv.style.display = "none";
iconsDiv.innerHTML = iconsSvg;
document.body.insertBefore(iconsDiv, document.body.firstChild);

// Baked anchor call
await zintl();

// A baked build serves each locale from its own `/<locale>/` document, so the
// bar links rather than switching in place — `currentRoute` reads which one
// this document is, and keeps the reader on the same page across the switch.
const { locale } = currentRoute(window.location.pathname);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  ${localeBar(locale, "about.html")}

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
    <a href="index.html" class="counter">Go back Home</a>
  </section>

  <div class="ticks"></div>
  <section id="spacer"></section>
`;
