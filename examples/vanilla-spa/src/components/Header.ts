// import { zintl } from "zintljs/macro";

/**
 * This app's own chrome: a brand and its routes.
 *
 * The locale bar is deliberately *not* here. It is the one piece of UI every
 * Zintl example shares, so it is rendered by `main.ts` from `switcher.ts` in the
 * same shape as every other example — see `docs/examples-locale-bar.md`.
 */
export async function Header(_currentLocale: string) {
  // Establishing an independent anchor for the header
  // await zintl(currentLocale);

  const container = document.createElement("header");
  container.className = "app-header";

  container.innerHTML = `
    <nav class="navbar">
      <div class="nav-brand">
        <span class="brand-text">Zintl</span>
      </div>
      <div class="nav-links">
        <a href="/" class="nav-link">Home</a>
        <a href="/about" class="nav-link">About</a>
      </div>
    </nav>
  `;

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("nav-link")) {
      e.preventDefault();
      const path = target.getAttribute("href");
      if (path) {
        window.dispatchEvent(new CustomEvent("navigate", { detail: path }));
      }
    }
  });

  return container;
}
