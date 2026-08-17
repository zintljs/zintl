import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import App from "./App.vue";
import "./index.css";

async function bootstrap() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);
  createApp(App).mount("#root");
}

void bootstrap();
