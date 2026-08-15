import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import App from "./App.vue";
import "./index.css";

async function bootstrap() {
  // 1. Resolve the current locale from URL query params, falling back to English
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await catalog loading and hydration
  await zintl(lang);

  // 3. Mount only once translations are active
  createApp(App).mount("#root");
}

void bootstrap();
