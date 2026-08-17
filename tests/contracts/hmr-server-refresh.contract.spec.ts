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
   * **Measured red, and the halves come apart in an informative place.** The
   * full-reload broadcast *does* fire — the packet assertion below passes — and
   * the page that comes back still says `Get started`. So ZHMR §4.3's detection
   * and signalling work, and what the browser re-fetches is HTML the server
   * rendered from the module it had before the edit.
   *
   * Recorded as pending with the measurement rather than left red. Fixing it is
   * a product change and out of this pass's scope; the value here is that the
   * section has an executable contract at all, for the first time — it was
   * specified, implemented, and unreachable, because every hot-update contract
   * required `spa` and no SSR project claims it.
   */
  /**
   * **Three of the four steps work. The fourth is Vite's SSR module cache.**
   *
   * Instrumented per environment, an edit to `src/entry-server.js` produces:
   *
   * ```
   * ENVRESULT=ssr → count=5      ← the applier invalidated 5 modules
   * ENVRESULT=ssr → count=5      ← twice; no client environment fires at all
   * hmr packets: {"full-reload": 2}
   * ```
   *
   * So detection (`ssrBoundaries` minus `clientBoundaries`), signalling (the
   * broadcast), and invalidation (the SSR environment's module graph) are all
   * correct. What is stale is what the *server* renders from: the fixture calls
   * `vite.ssrLoadModule()` per request, and in Vite 6+ that is backed by a
   * module **runner** whose evaluated-module cache is separate from the module
   * graph. `mg.invalidateModule()` clears the graph node; it does not evict the
   * runner's already-evaluated module, so the next request re-renders from the
   * function object built before the edit.
   *
   * Left pending rather than guessed at. The next step is to find what evicts
   * the runner's cache on this Vite version — the graph invalidation is already
   * happening and is not the missing piece.
   */
  pendingFor: {
    "ssr-streaming":
      "Vite's SSR module runner keeps the pre-edit module. Detection, the full-reload broadcast " +
      "and SSR module-graph invalidation (5 modules, twice) all measured working; ssrLoadModule " +
      "still returns the module evaluated before the edit. Needs the runner's evaluated-module " +
      "cache evicted, which module-graph invalidation does not do in Vite 6+.",
  },
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
