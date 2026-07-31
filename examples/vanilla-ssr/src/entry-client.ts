import "./style.css";
import { setupCounter } from "./counter";
import { zintl } from "zintljs/macro";

await zintl();
setupCounter(document.querySelector("#counter") as HTMLButtonElement);
