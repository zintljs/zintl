import "./style.css";
import { createApp } from "./main";
import { zintl } from "zintl/macro";

const { app } = createApp();

await zintl();
app.mount("#app");
