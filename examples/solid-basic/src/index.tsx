/* @refresh reload */
import { render } from "solid-js/web";
import { zintl } from "zintljs/macro";
import "./index.css";
import App from "./App.tsx";

/**
 * The solid-ts template renders immediately. The only addition is the trust
 * anchor: `zintl(lang)` is awaited first, so the tree is never painted
 * untranslated.
 */
async function bootstrap() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);

  const root = document.getElementById("root");
  render(() => <App />, root!);
}

void bootstrap();
