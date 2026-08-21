import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { zintl } from "zintljs/macro";
import "./index.css";
import App from "./App.tsx";

/**
 * The trust anchor lives here, not in `App.tsx` — the same split
 * `examples/react-basic` and `examples/preact-basic` use, and for a reason worth
 * stating: a file holding an anchor is an entry, and Solid declares
 * `entryReexecutionSafe: false` because `render()` appends rather than replaces.
 * Put the anchor in the component file and every catalog update to that
 * boundary costs a full page reload instead of an in-place repaint.
 */
function Root() {
  const [lang, setLang] = createSignal(
    new URLSearchParams(window.location.search).get("lang") || "en",
  );

  const handleSwitch = async (newLang: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", newLang);
    window.history.pushState({}, "", url.pathname + url.search);
    await zintl(newLang);
    setLang(newLang);
  };

  return <App lang={lang()} onSwitch={handleSwitch} />;
}

async function bootstrap() {
  // 1. Determine the target locale (e.g., from URL, storage, or browser preferences)
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await Zintl catalog loading and hydration
  await zintl(lang);

  // 3. Render the Solid tree only when translations are ready
  render(() => <Root />, document.getElementById("root")!);
}

void bootstrap();
