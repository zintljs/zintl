import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import "./style.css";
import App from "./App.vue";

import { router } from "./router";

async function bootstrap() {
  // 1. Resolve current locale from URL query params or fallback to English
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await zintl locale loading and catalog hydration
  await zintl(lang);

  // 3. Mount Vue App after translations are active
  const app = createApp(App);
  app.use(router);
  app.mount("#app");
}

void bootstrap();
