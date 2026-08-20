import { executeContract, type Contract, type HmrAdapter, type SsrAdapter } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";

/**
 * A server-only edit reaches the browser as a full reload (ZHMR §4.3).
 *
 * **Never executed before this contract existed.** Every hot-update contract in
 * the suite declared `requires: ["spa", "hmr"]`, and `spa` is not a claim any
 * SSR project makes — so `react-ssr` carried a `hmr` capability that selected
 * exactly zero tests, and §4.3 was specified, implemented, and unobserved.
 *
 * The rule it asserts is the one place Zintl cannot rely on the bundler's own
 * machinery. Browser HMR only reaches modules in the browser's graph, and a
 * server entry is not in it — the update is not slow or lost, it is
 * *unaddressable*. Zintl closes that by tracking `ssrBoundaries` against
 * `clientBoundaries` and, when a change touches the former and not the latter,
 * sending `{ type: "full-reload", path: "*" }` itself.
 *
 * So the reload is the **success** condition here, which inverts every other
 * hot-update contract in this directory. `catalog-edit` fails when it sees a
 * full reload; this one fails when it does not.
 *
 * Rsbuild is absent by capability rather than by silence: nothing on that host
 * ever populates `ssrBoundaries`, because SSR is unbuilt there.
 */

export const hmrServerRefreshContract: Contract<SsrAdapter & HmrAdapter> = {
  name: "HMR Server Refresh",
  description: "Verifies an edit to a server-only boundary triggers a full reload with fresh HTML",
  /**
   * Not gated on `hmr`, for the same reason `asset-hmr` is not: the guarantee
   * here is that the browser is *told to reload*, which is what happens
   * precisely because a hot update is impossible. A project can satisfy this
   * and have no client module graph at all — `ssr-streaming` has no client
   * script — so requiring `hmr` would exclude the purest example of it.
   */
  requires: ["ssr", "hmr-server-refresh"],
  /**
   * **Green, and the fourth step was never the module runner.**
   *
   * This contract was measured red for its whole life with the diagnosis
   * "detection, signalling and SSR module-graph invalidation all work;
   * `ssrLoadModule` returns the module evaluated before the edit". Three of
   * those four observations were correct. The conclusion was not, and the
   * reason it survived is the one L-060 records: **every piece of evidence was
   * taken on the server.**
   *
   * `interceptViteHmr` wraps `ws.send`, so `hmr packets: {"full-reload": 8}`
   * says the server broadcast eight times — not that anything heard one. This
   * fixture streams its own document with an empty `<head>`, so the page had no
   * `/@vite/client` and therefore no socket at all. The browser never reloaded,
   * never re-requested, and the unchanged text was read as a stale server
   * render. The runner's cache was never reached, let alone stale.
   *
   * Two things had to change, and both are about the fixture modelling dev SSR
   * honestly rather than about Zintl:
   *
   * 1. **The page carries Vite's client.** A real app gets it from
   *    `transformIndexHtml`; a fixture that builds its own document has to say
   *    so. Adding it immediately surfaced a genuine product defect — the dev
   *    HMR snippet was spliced before the file's last `</script>`, which for a
   *    plain module is inside a string literal (ledger L-073).
   * 2. **The HMR socket rides the app's own server.** In middleware mode Vite
   *    otherwise opens a second listener on a fixed port, shared by every SSR
   *    project across four workers.
   *
   * ZHMR §4.3 holds on `ssr-streaming`, and the same wiring is what let
   * `react-ssr` reclaim the `hmr` capability it had been carrying unmeasured.
   */
  async execute(lab, adapter) {
    const edit = adapter.serverOnlyEdit;
    if (!edit) {
      throw new Error(
        `This project claims "hmr-server-refresh" without declaring "serverOnlyEdit". The ` +
          `capability *is* the claim that the adapter can name a server-only string; claiming ` +
          `it without naming one is the single state the capability model cannot express.`,
      );
    }

    await adapter.navigateHome(lab);
    await lab.clock.waitForIdle();
    await lab.assert.textEventually(adapter.headingSelector, adapter.initialHeadingText);

    const capture = lab.ws.capture();

    await lab.fs.edit(edit.file, (content) => {
      if (!content.includes(edit.find)) {
        throw new Error(
          `${edit.file} does not contain ${JSON.stringify(edit.find)}. The adapter's ` +
            `serverOnlyEdit has drifted from the project it describes.`,
        );
      }
      return content.replace(edit.find, edit.replaceWith);
    });

    // 1. The browser was told, and told the only way it could have been.
    const packets = capture.stop();
    if (!packets.some((p) => p.type === "full-reload")) {
      throw new Error(
        `Editing the server-only boundary ${edit.file} produced no full-reload packet — saw ` +
          `${packets.length}: ${packets.map((p) => p.type).join(", ") || "(none)"}.\n\n` +
          `A server-only module is not in the browser's module graph, so no hot update can ` +
          `address it. Without the broadcast the page keeps rendering HTML the server no ` +
          `longer produces, and nothing later repairs it.\n\n` +
          (await lab.assert.describeStall()),
      );
    }

    // 2. What came back is genuinely re-rendered, not a reload of stale output.
    await lab.assert.textEventually(adapter.headingSelector, edit.replaceWith);
  },
};

executeContract(hmrServerRefreshContract, allManifests);
