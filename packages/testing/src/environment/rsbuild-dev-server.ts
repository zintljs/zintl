import type { DevServerDriver, LabDevServerHandle } from "./dev-server-driver.js";
import type { HmrPacket } from "./websocket.js";
import { createServer } from "node:net";

/**
 * Ask the OS for a free port.
 *
 * Vite treats `port: 0` as "pick an ephemeral port", which can never collide.
 * Rsbuild does not — it serves on literal port 0 — so the driver used to pass
 * `undefined` and let every project start from Rsbuild's default of 3000. With
 * one Rsbuild example that was invisible. With two running on different workers
 * it is a race, and the loser dies with
 * `EADDRINUSE: address already in use ::1:3001` while its contract sits there
 * until the 45s timeout. That is what every wandering "timeout" on an Rsbuild
 * project turned out to be.
 *
 * Binding to 0 and closing leaves a small window before Rsbuild listens, which
 * is why `strictPort` stays off: if something takes the port in between,
 * Rsbuild increments instead of failing.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(chosen));
    });
  });
}

/**
 * Rsbuild's hot-update packets, in the lab's vocabulary.
 *
 * `hash` then `ok` is what Rsbuild sends after a successful compilation, and the
 * `ok` is the moment the client has applied it — so `ok` is what Vite calls
 * `update`.
 *
 * **`hash`, `errors` and `warnings` are recorded rather than dropped**, under
 * their own names. They used to be discarded as carrying nothing a contract asks
 * for, and that reasoning missed what the *diagnosis* asks for: with only `ok`
 * and `full-reload` retained, "the server never sent an update" and "the server
 * sent one and the client never applied it" produce an identical empty packet
 * log — which is exactly the distinction `describeStall` claims to draw. A
 * failing build sends `hash` then `errors`; a recovery sends `hash` then `ok`.
 * Seeing the first pair without the second is the whole answer, and it was being
 * thrown away on the way in.
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
    case "hash":
    case "errors":
    case "warnings":
      return { type: msg.type, timestamp, data: msg.data };
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

    /**
     * Say "development" the way the CLI does, before anything reads it.
     *
     * `rsbuild dev` sets `NODE_ENV=development` **before** `createRsbuild`, and
     * `startDevServer`'s own fallback is `process.env.NODE_ENV || setNodeEnv(…)`
     * — a no-op here, because Vitest has already set `"test"` and that is truthy.
     * Passing `mode: "development"` below fixes the build output but leaves every
     * other consumer of `NODE_ENV` reading `"test"`.
     *
     * The point of this driver is to reproduce what a user runs. Each divergence
     * from the CLI is a place where a harness result stops describing reality,
     * and this file has already paid for two of those (ledger L-020, L-031).
     */
    process.env.NODE_ENV = "development";

    const { content: fileConfig } = await loadConfig({
      cwd: root,
      /**
       * What the CLI passes. Without them `loadConfig` derives `command` from
       * `process.argv[2]` — Vitest's — and `envMode` from `NODE_ENV`, so a config
       * that branches on either saw a shape no real invocation produces.
       */
      command: "dev",
      envMode: "development",
    });

    /** An explicit port is honoured; otherwise take one the OS says is free. */
    const resolvedPort = port || (await freePort());

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
         * anything, and every contract on `rsbuild-react-basic` failed on an empty
         * page rather than on what it was testing.
         *
         * Worth stating explicitly regardless of that bug: a driver whose job is
         * to start a dev server should not be describing itself as a test run.
         */
        mode: "development",
        /**
         * `info`, matching the CLI — not `"error"`, which this used to force.
         *
         * Rsbuild propagates `logLevel` into the browser as `dev.client.logLevel`,
         * so silencing the server also silenced the **HMR client**: "WebSocket
         * connection lost. Reconnecting…", the max-retry warning, and the
         * connect/apply messages all stopped reaching `LabConsole`. A whole class
         * of failure therefore arrived looking like nothing had happened at all,
         * which is precisely what made the `rsbuild-react-basic` intermittency take five
         * investigations to characterise.
         *
         * The extra server-side noise is worth it: contract output is only read
         * when something failed.
         */
        logLevel: "info",
        server: { ...(fileConfig as any)?.server, port: resolvedPort, strictPort: !!port },
        dev: { ...(fileConfig as any)?.dev, progressBar: false },
      },
    });

    /**
     * Take back the process-level shutdown handlers, and with them the right to
     * kill this process.
     *
     * `setupGracefulShutdown` registers `process.once("SIGTERM", …)` — plus, off
     * CI, a `process.stdin` `"end"` listener — and both call
     * `handleTermination`, which ends in `process.exit()`. Correct for a CLI,
     * and wrong in a test runner: a worker that receives SIGTERM during teardown
     * is force-exited with `SIGTERM + 128` before Vitest can finish, which
     * surfaces as a **non-zero exit with no failing test** — the signature that
     * made `flake.js` read `9/10` on a suite whose every case passed.
     *
     * It also leaks. Rsbuild builds a *new closure per server* and removes it
     * only when a refcount returns to zero:
     *
     *     !(--shutdownRefCount > 0) && process.removeListener("SIGTERM", onSigterm)
     *
     * so of N pooled servers, N−1 handlers are never removed — which is the
     * `MaxListenersExceededWarning: 11 SIGTERM listeners` this suite prints.
     *
     * Vite needs none of this: it keeps one shared `parentSigtermCallback`,
     * registered when its callback set goes 0→1 and removed at 0, so a hundred
     * servers still add one listener and give it back. The asymmetry is the
     * reason this lives here and not in `dev-server.ts`.
     *
     * Dropped immediately rather than in `close()`, because servers are pooled
     * for the lifetime of a worker — deferring would leave the hazard armed for
     * almost the whole run. Nothing is lost: `close()` already shuts the server
     * down, and Rsbuild's own cleanup removing an absent listener is a no-op.
     */
    const sigtermBefore = new Set<unknown>(process.listeners("SIGTERM"));
    const stdinEndBefore = new Set<unknown>(process.stdin.listeners("end"));

    const server = await rsbuild.startDevServer();

    for (const listener of process.listeners("SIGTERM")) {
      if (!sigtermBefore.has(listener)) process.removeListener("SIGTERM", listener);
    }
    for (const listener of process.stdin.listeners("end")) {
      if (!stdinEndBefore.has(listener)) {
        process.stdin.removeListener("end", listener as (...args: unknown[]) => void);
      }
    }

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
