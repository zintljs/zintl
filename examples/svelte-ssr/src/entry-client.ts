import "./app.css";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { zintl } from "zintl/macro";

async function bootstrap() {
  await zintl();
  hydrate(App, {
    target: document.getElementById("app")!,
  });
}

void bootstrap();
