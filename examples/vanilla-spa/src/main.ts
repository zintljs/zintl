import "./style.css";
import { Router } from "./router";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { zintl } from "zintljs/macro";

async function initApp() {
  const params = new URLSearchParams(window.location.search);
  let currentLocale = params.get("lang") || "en";
  // await zintl(currentLocale);

  const appRoot = document.querySelector<HTMLDivElement>("#app")!;
  const headerContainer = document.createElement("div");
  const contentContainer = document.createElement("main");

  appRoot.innerHTML = "";
  appRoot.appendChild(headerContainer);
  appRoot.appendChild(contentContainer);

  const router = new Router(contentContainer);

  const updateApp = async (locale: string) => {
    currentLocale = locale;

    // Hydrate the app with the new locale's translations
    await zintl(currentLocale);

    // Update Header
    headerContainer.innerHTML = "";
    headerContainer.appendChild(await Header(currentLocale));

    // Update Router
    void router.init();
  };

  router.addRoute("/", () => Home());
  router.addRoute("/about", async () => {
    const { About } = await import("./pages/About");
    return About();
  });

  // Global listeners
  window.addEventListener("locale-change", (e: any) => {
    const newLocale = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLocale);
    window.history.pushState({}, "", url);
    void updateApp(newLocale);
  });

  window.addEventListener("navigate", (e: any) => {
    void router.navigate(e.detail);
  });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const newLocale = params.get("lang") || "en";
    if (newLocale !== currentLocale) {
      void updateApp(newLocale);
    }
  });

  // Initial render
  await updateApp(currentLocale);
}

void initApp();
