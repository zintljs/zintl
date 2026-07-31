import "./style.css";
import { createApp } from "./main";
import { zintl } from "zintljs/macro";

const { app } = createApp();

await zintl();
app.mount("#app");
