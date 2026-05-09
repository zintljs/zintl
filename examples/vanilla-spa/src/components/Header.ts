// import { zintl } from "zintl";

export async function Header(currentLocale: string) {
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
      <!-- @zintl-ignore -->
      <div class="locale-switcher">
        <button data-locale="en" class="lang-btn ${currentLocale === "en" ? "active" : ""}">English</button>
        <button data-locale="ar" class="lang-btn ${currentLocale === "ar" ? "active" : ""}">العربية</button>
        <button data-locale="es" class="lang-btn ${currentLocale === "es" ? "active" : ""}">Español</button>
      </div>
    </nav>
  `;

  // Use event delegation for locale switching
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("lang-btn")) {
      const locale = target.dataset.locale;
      if (locale) {
        window.dispatchEvent(new CustomEvent("locale-change", { detail: locale }));
      }
    }

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
