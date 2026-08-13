import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { zintl } from "zintljs/macro";
import App from "./App.tsx";

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
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Main />
    </StrictMode>,
  );
}

void bootstrap();
