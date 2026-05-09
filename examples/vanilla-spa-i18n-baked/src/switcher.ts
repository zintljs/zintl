export function setupSwitcher(element: HTMLElement) {
  const lang = (window.location.pathname.split("/")[1] as any) || "en";

  const locales = [
    { id: "en", name: "English" },
    { id: "ar", name: "العربية" },
    { id: "es", name: "Español" },
    { id: "zh", name: "中文" },
  ];

  element.innerHTML = locales
    .map(
      (l) => `
    <button data-lang="${l.id}" class="${lang === l.id ? "active" : ""}">
      <a href="/${l.id}/">${l.name}</a>
    </button>
  `,
    )
    .join("");

  // element.querySelectorAll("button").forEach((btn) => {
  //   btn.addEventListener("click", () => {
  //     const newLang = (btn as HTMLElement).dataset.lang!;
  //     window.history.pushState({}, "", `/${newLang}`);
  //   });
  // });
}
