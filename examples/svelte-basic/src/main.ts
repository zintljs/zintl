import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { zintl } from "zintljs/macro";

async function bootstrap() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);
  mount(App, {
    target: document.getElementById("app")!,
  });
}

void bootstrap();
