import { zintl } from "zintljs/macro";
import "./index.css";
import "./my-element.ts";

async function bootstrap() {
  // 1. Determine the target locale (e.g., from URL, storage, or browser preferences)
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await Zintl catalog loading and hydration
  await zintl(lang);

  // 3. Upgrade the element only when translations are ready. `<my-element>` is
  //    created here rather than written into `index.html` so that its first
  //    render already has a catalog — a custom element in the document would
  //    upgrade the moment its module is imported, which is before this resolves.
  document.getElementById("app")!.appendChild(document.createElement("my-element"));
}

void bootstrap();
