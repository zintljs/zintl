import { render } from "preact";
import { useState } from "preact/hooks";
import { zintl } from "zintljs/macro";
import "./index.css";
import { App } from "./app.tsx";

/**
 * `create-vite`'s **preact-ts** starter renders in five lines:
 *
 * ```tsx
 * render(<App />, document.getElementById("app")!)
 * ```
 *
 * Everything below is the localization layer. `zintl(lang)` is the trust anchor,
 * awaited before the first render so the tree is never painted untranslated, and
 * `Main` holds the locale the bar switches.
 */
function Main() {
  const [lang, setLang] = useState(
    () => new URLSearchParams(window.location.search).get("lang") || "en",
  );

  const handleSwitch = async (newLang: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url.pathname + url.search);
    await zintl(newLang);
    setLang(newLang);
  };

  return <App lang={lang} onSwitch={handleSwitch} />;
}

async function bootstrap() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);
  render(<Main />, document.getElementById("app")!);
}

void bootstrap();
