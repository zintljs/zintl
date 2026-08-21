import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { zintl } from "zintljs/macro";
import { setupCounter } from "./counter";
import { localeBar, setupSwitcher } from "./switcher";
import aboutTxt from "./assets/about.txt?raw";

// export function setupCounter(element: HTMLButtonElement) {
//   let counter = 0;
//   const setCounter = (count: number) => {
//     counter = count;
//     element.innerHTML = t(
//       "{counter, plural, zero {Start Counting Now!} one {Count is One.} two {Count is Two} other {Count is #}}",
//       { counter },
//     );
//   };
//   element.addEventListener("click", () => setCounter(counter + 1));
//   setCounter(0);
// }

async function render() {
  const params = new URLSearchParams(window.location.search);

  // zintlizing to search params lang, default to "en", hence no baking allowed for this flow.
  await zintl(params.get("lang") || "en");

  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = `
    ${localeBar()}

    <div>
      <a href="https://vite.dev" target="_blank">
        <img src="${viteLogo}" class="logo" alt="Vite logo" />
      </a>
      <a href="https://www.typescriptlang.org/" target="_blank">
        <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
      </a>
      <div class="hero-container">
        <img src="${heroImg}" class="hero-image" alt="Zintl Hero" />
        <!-- @zintl-note This is a note for the compiler -->
        <h1 class="hero-title">Zintl I18n</h1>
        <p class="hero-subtitle">Compiler-driven internationalization for the modern web.</p>
      </div>

      <div class="card">
        <button id="counter" type="button"></button>
      </div>

      <div class="about-section" style="margin: 20px; padding: 15px; border: 1px solid #ccc; border-radius: 8px; font-family: sans-serif; white-space: pre-line;">
        ${aboutTxt}
      </div>

    </div>
  `;

  setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);

  // Switching is the shared bar's business; this app only has to repaint.
  setupSwitcher(app.querySelector<HTMLDivElement>("#switcher")!, async (lang) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    window.history.pushState({}, "", url.pathname + url.search);
    await render();
  });
}

// Initial render
await render();
