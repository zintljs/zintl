const locales = [
  { id: "en", name: "English" },
  { id: "ar", name: "العربية" },
  { id: "es", name: "Español" },
  { id: "zh", name: "中文" },
];

export function LocaleSwitcher(_url: string) {
  const lang = (_url.split("/")[1] as any) || "en";

  return locales
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
