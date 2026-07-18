import { closeSharedBrowser, closeSharedServers, closeSharedPreviewServers } from "@zintl/testing";

export async function teardown() {
  await closeSharedServers();
  await closeSharedPreviewServers();
  await closeSharedBrowser();
}
