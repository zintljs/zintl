import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import "./style.css";
import AboutApp from "./AboutApp.vue";

async function bootstrap() {
  // 1. Resolve current locale from URL query params or fallback to English
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  // 2. Await zintl locale loading and catalog hydration
  await zintl(lang);

  // 3. Mount Vue App after translations are active
  createApp(AboutApp).mount("#app");
}

void bootstrap();
