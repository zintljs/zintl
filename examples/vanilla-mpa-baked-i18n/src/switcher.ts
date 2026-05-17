export function setupSwitcher(element: HTMLElement) {
  const paths = window.location.pathname.split("/").filter(Boolean);
  let currentLocale = "en";
  let pagePath = "";

  if (paths.length > 0) {
    if (["en", "ar", "es", "zh"].includes(paths[0])) {
      currentLocale = paths[0];
      pagePath = paths.slice(1).join("/");
    } else {
      pagePath = paths.join("/");
    }
  }

  const locales = [
    { id: "en", name: "English" },
    { id: "ar", name: "العربية" },
    { id: "es", name: "Español" },
    { id: "zh", name: "中文" },
  ];

  element.innerHTML = locales
    .map(
      (l) => `
    <button data-lang="${l.id}" class="${currentLocale === l.id ? "active" : ""}">
      <a href="/${l.id}/${pagePath}">${l.name}</a>
    </button>
  `,
    )
    .join("");
}
