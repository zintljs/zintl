import { render as _render } from "svelte/server";
import App from "./App.svelte";
import { zintl } from "zintl/macro";

export async function render(_url: string) {
  await zintl();
  return _render(App);
}
