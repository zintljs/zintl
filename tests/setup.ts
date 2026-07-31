import {
  closeSharedBrowser,
  closeSharedServers,
  closeSharedPreviewServers,
} from "@zintljs/testing";

export async function teardown() {
  await closeSharedServers();
  await closeSharedPreviewServers();
  await closeSharedBrowser();
}
