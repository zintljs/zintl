import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import AboutApp from "./AboutApp.vue";
import "./index.css";

async function bootstrap() {
  const lang = new URLSearchParams(window.location.search).get("lang") || "en";
  await zintl(lang);
  createApp(AboutApp).mount("#root");
}

void bootstrap();
