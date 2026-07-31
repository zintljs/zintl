import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";
import { zintl } from "zintljs/macro";

export async function render(_url: string) {
  await zintl();
  const html = renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return { html };
}
