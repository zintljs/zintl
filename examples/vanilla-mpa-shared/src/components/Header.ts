import { zintl } from "zintljs/macro";

export async function Header(locale: string) {
  await zintl(locale);

  const container = document.createElement("header");
  container.id = "shared-header";
  container.className = "shared-header-nav";
  container.innerHTML = `
    <nav class="shared-nav">
      <span class="logo-text">Zintl MPA Shared</span>
      <div class="nav-links">
        <a href="/?lang=${locale}">Home Navigation</a>
        <a href="/about?lang=${locale}">About Navigation</a>
      </div>
    </nav>
  `;
  return container;
}
