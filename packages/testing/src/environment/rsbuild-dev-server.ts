import type { DevServerDriver, LabDevServerHandle } from "./dev-server-driver.js";
import type { HmrPacket } from "./websocket.js";

/**
 * Rsbuild's hot-update packets, in the lab's vocabulary.
 *
 * `hash` then `ok` is what Rsbuild sends after a successful compilation, and the
 * `ok` is the moment the client has applied it — so `ok` is what Vite calls
 * `update`. `hash` carries no information a contract asks for and is dropped;
 * so are `errors`/`warnings`, which `LabConsole` already covers.
 *
 * `static-changed` is Rsbuild's own documented alias for `full-reload`, kept for
 * backward compatibility on its side; both mean the same thing here.
 */
function translateRsbuildPacket(raw: string): HmrPacket | null {
  const msg = JSON.parse(raw) as { type?: string; data?: unknown };
  const timestamp = Date.now();
  switch (msg.type) {
    case "ok":
      return { type: "update", timestamp, data: msg.data };
    case "full-reload":
    case "static-changed":
      return { type: "full-reload", timestamp, data: msg.data };
    default:
      return null;
  }
}

/**
 * An Rsbuild dev server, for proposals 026 and 029.
 *
 * Watches hot updates from the **client** rather than the server, via
 * `clientHmr`. Rsbuild's `socketServer` lives on an internal context that
 * `initPluginAPI` narrows away before any plugin sees it, so there is no public
 * server object to patch the way `interceptViteHmr` patches `ws.send` — and
 * reaching past the public API for one would make the harness depend on an
 * internal shape. Reading the page's own socket needs nothing but Playwright,
 * and records what the browser actually received, which is what the contracts
 * asking for packets are really asking about.
 *
 * This replaced a deliberate refusal: before proposal 029 there were no hot
 * updates to watch on this host, and offering a packet channel would have
 * suggested a story that did not exist.
 */
export class RsbuildDevServerDriver implements DevServerDriver {
  readonly name = "rsbuild";

  async start(root: string, _projectName: string, port: number): Promise<LabDevServerHandle> {
    /**
     * Imported lazily, like `RsbuildDriver` does and for the same reason: this
     * module is reachable from the `@zintljs/testing` barrel, and a top-level
     * import would make every Vite contract pay to load Rspack's native binding.
     */
    const { createRsbuild, loadConfig } = await import("@rsbuild/core");

    const { content: fileConfig } = await loadConfig({ cwd: root });

    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        ...fileConfig,
        root,
        /**
         * Say that this is a dev server, rather than letting Rsbuild infer it.
         *
         * Rsbuild derives `mode` from `NODE_ENV`, and Vitest sets `NODE_ENV` to
         * `"test"` — which is neither of the values it recognises, so it emitted
         * no `process.env.NODE_ENV` define at all. Harmless for a vanilla app and
         * fatal for React, whose development build reads that variable: the
         * bundle threw `ReferenceError: process is not defined` before rendering
         * anything, and every contract on `rsbuild-react` failed on an empty
         * page rather than on what it was testing.
         *
         * Worth stating explicitly regardless of that bug: a driver whose job is
         * to start a dev server should not be describing itself as a test run.
         */
        mode: "development",
        logLevel: "error",
        server: { ...(fileConfig as any)?.server, port: port || undefined, strictPort: !!port },
        dev: { ...(fileConfig as any)?.dev, progressBar: false },
      },
    });

    const server = await rsbuild.startDevServer();

    return {
      url: server.urls[0] ?? `http://localhost:${server.port}`,
      native: server,
      root,
      clientHmr: { pathMatch: "/rsbuild-hmr", translate: translateRsbuildPacket },
      async close() {
        await server.server.close();
      },
    };
  }
}
