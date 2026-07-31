import "./index.css";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./App";
import { zintl } from "zintljs/macro";

async function bootstrap() {
  await zintl();
  hydrateRoot(
    document.getElementById("root") as HTMLElement,
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void bootstrap();
