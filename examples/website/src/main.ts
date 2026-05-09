import "./style.css";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import heroImg from "./assets/hero.png";
import { zintl } from "zintl";
import { setupCounter } from "./counter";

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

      <div class="language-switcher">
        <!-- @zintl-ignore -->
        <button id="set-ar">العربية</button>
        <!-- @zintl-ignore -->
        <button id="set-en">English</button>
        <!-- @zintl-ignore -->
        <button id="set-es">Español</button>
      </div>

    </div>
  `;

  setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);

  // 2. Logic to toggle language using the unified API
  document.querySelector("#set-en")?.addEventListener("click", async () => {
    history.pushState({}, "", "?lang=en");
    await render();
  });
  document.querySelector("#set-ar")?.addEventListener("click", async () => {
    window.history.pushState({}, "", `?lang=ar`);
    await render();
  });
  document.querySelector("#set-es")?.addEventListener("click", async () => {
    window.history.pushState({}, "", `?lang=es`);
    await render();
  });
}

// Initial render
await render();
