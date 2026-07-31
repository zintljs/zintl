import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { useState } from "react";
import { zintl } from "zintljs/macro";

function Main() {
  const [lang, setLang] = useState(() => {
    return new URLSearchParams(window.location.search).get("lang") || "en";
  });

  const handleSwitch = async (newLang: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url);
    await zintl(newLang);
    setLang(newLang);
  };

  return <App lang={lang} onSwitch={handleSwitch} />;
}

async function bootstrap() {
  // 1. Determine the target locale (e.g., from URL, storage, or browser preferences)
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await Zintl catalog loading and hydration
  await zintl(lang);
  // 3. Render the React tree only when translations are ready
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Main />
    </StrictMode>,
  );
}
void bootstrap(); // touch to trigger re-transform
