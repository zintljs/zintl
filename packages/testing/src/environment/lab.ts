import type { Page } from "@playwright/test";
import { createLabBrowser, type LabBrowser } from "./browser.js";
import { createLabDevServer, type LabDevServer } from "./dev-server.js";
import { createLabPreviewServer, type LabPreviewServer } from "./preview-server.js";
import { LabFilesystem } from "./filesystem.js";
import { LabCompiler } from "./compiler.js";
import { LabWebSocket, clientHmrIntercept } from "./websocket.js";
import { LabNetwork } from "./network.js";
import { LabConsole } from "./console.js";
import { LabClock } from "./clock.js";
import { LabAssertions } from "../assertions/index.js";
import { LabPipeline } from "./pipeline.js";
import type { BuildToolDriver, DriverKind, ZintlPluginOptions } from "./driver.js";
import type { MaterializedProject, ProjectSource } from "../contracts/source.js";

export interface LabOptions {
  source: ProjectSource;
  /** Which build tool serves this project. Defaults to Vite. */
  driver?: DriverKind;
  mode?: "dev" | "preview";
  port?: number;
  env?: Record<string, string>;
  headless?: boolean;
  /**
   * Why this lab is exempt from strict delivery, when it is.
   *
   * Set from the contract's own declaration. Assigned after construction rather
   * than threaded through the constructor, which already takes nine positional
   * arguments — one more optional tail parameter is how a call site ends up
   * silently passing eight of nine and disabling a branch nobody notices.
   */
  strictDeliveryExempt?: string;
}

export interface ProjectLabOptions {
  source: ProjectSource;
  zintlOptions: ZintlPluginOptions;
  /** Which build tool to drive. Defaults to Vite. */
  driver?: DriverKind;
}

export interface Lab {
  readonly page: Page;
  readonly browser: LabBrowser;
  readonly server: LabDevServer | LabPreviewServer;
  readonly fs: LabFilesystem;
  readonly compiler: LabCompiler;
  readonly ws: LabWebSocket;
  readonly network: LabNetwork;
  readonly console: LabConsole;
  readonly clock: LabClock;
  readonly assert: LabAssertions;
  readonly pipeline: LabPipeline;
  readonly driver: BuildToolDriver;
  readonly url: string;
  readonly root: string;
  /**
   * Wait until the Zintl runtime reports it has applied pending work.
   *
   * Causal where `clock.waitForIdle()` is a guess: it gates on the runtime's
   * settle counter, which advances on every locale change and catalog
   * application. Called automatically after each filesystem mutation.
   */
  waitForSettled(opts?: { timeout?: number }): Promise<void>;
  teardown(): Promise<void>;
}

class LabImpl implements Lab {
  /** Why strict delivery does not apply here; see `LabOptions`. */
  strictDeliveryExempt?: string;
  readonly page: Page;
  readonly browser: LabBrowser;
  readonly server: LabDevServer | LabPreviewServer;
  readonly fs: LabFilesystem;
  readonly compiler: LabCompiler;
  readonly ws: LabWebSocket;
  readonly network: LabNetwork;
  readonly console: LabConsole;
  readonly clock: LabClock;
  readonly assert: LabAssertions;
  readonly pipeline: LabPipeline;
  readonly driver: BuildToolDriver;
  readonly url: string;
  readonly root: string;
  private readonly mode: "dev" | "preview" | "project";
  private readonly project: MaterializedProject;
  private settleBaseline: number | undefined;
  // private readonly exampleName: string;

  constructor(
    page: Page | undefined,
    browser: LabBrowser | undefined,
    server: LabDevServer | LabPreviewServer | undefined,
    url: string,
    project: MaterializedProject,
    mode: "dev" | "preview" | "project",
    fs: LabFilesystem,
    exampleName: string,
    zintlOptions: ZintlPluginOptions,
    driver: DriverKind = "vite",
  ) {
    this.mode = mode;
    this.project = project;
    const root = project.root;
    // this.exampleName = exampleName;
    const throwNoAccess = (propName: string) => {
      return new Proxy({} as any, {
        get() {
          throw new Error(`Property "${propName}" is not available in project lab mode`);
        },
      });
    };

    this.page = page ?? throwNoAccess("page");
    this.browser = browser ?? throwNoAccess("browser");
    this.server = server ?? throwNoAccess("server");
    this.url = url;
    this.root = root;

    const devServer = mode === "dev" ? (server as LabDevServer) : undefined;
    /**
     * Server-side interception where the host offers it, the page's own socket
     * otherwise. A host that offers neither still gets `undefined`, which
     * `LabWebSocket` reads as "cannot see packets" rather than "none were sent".
     */
    const hmrIntercept =
      devServer?.interceptHmr?.bind(devServer) ??
      (devServer?.clientHmr && page ? clientHmrIntercept(page, devServer.clientHmr) : undefined);
    this.ws = mode === "project" ? throwNoAccess("ws") : new LabWebSocket(hmrIntercept);
    this.network = mode === "project" ? throwNoAccess("network") : new LabNetwork(this.page);
    this.console = mode === "project" ? throwNoAccess("console") : new LabConsole(this.page);
    this.clock = mode === "project" ? throwNoAccess("clock") : new LabClock(this.page);
    this.compiler = new LabCompiler(root);
    this.assert = new LabAssertions(this);
    this.pipeline = new LabPipeline(exampleName, root, zintlOptions, driver);
    this.driver = this.pipeline.driver;

    const beforeMutation = async () => {
      if (mode !== "project") {
        this.settleBaseline = await this.readSettleCounter();
      }
    };

    const onMutation = async () => {
      if (mode !== "dev") return;

      /**
       * A contract that declared itself strict-delivery exempt has already told
       * us this write is not expected to settle — it introduces a syntax error,
       * or deletes a catalog. Waiting the full budget for a stall the contract
       * announced in advance is pure cost: a 4 s packet race that no packet will
       * end, then a 10 s settle wait for a beacon that will never advance, on
       * every such mutation.
       *
       * The real gate is the assertion. `textEventually` polls for fifteen
       * seconds, so shortening these does not weaken anything — it stops the
       * harness blocking on an outcome it was told not to expect.
       */
      const expected = !this.strictDeliveryExempt;
      const packetTimeout = expected ? 4000 : 400;
      const settleTimeout = expected ? 10000 : 1500;

      try {
        await Promise.race([
          this.ws.waitFor("update", { timeout: packetTimeout }),
          this.ws.waitFor("full-reload", { timeout: packetTimeout }),
        ]);
      } catch {
        // No HMR packet — waitForSettled below still gates on the runtime.
      }
      await this.waitForSettled({ timeout: settleTimeout });
    };

    this.fs = fs;
    this.fs.setBeforeMutationCallback(beforeMutation);
    this.fs.setMutationCallback(onMutation);
  }

  /**
   * Read the runtime's settle counter, or `undefined` when it is unavailable
   * (before first navigation, or on a page with no Zintl runtime).
   */
  private async readSettleCounter(): Promise<number | undefined> {
    try {
      return await this.page.evaluate(
        () => (globalThis as { __zintl_version?: number }).__zintl_version,
      );
    } catch {
      // Page not ready or navigating — no baseline to compare against.
      return undefined;
    }
  }

  /**
   * Whether a missing or stalled signal should fail rather than fall through.
   *
   * A contract that deliberately breaks the application is exempt: a syntax
   * error *should* stall the runtime, so reporting it as a stall is reporting
   * correct behaviour as a defect.
   */
  private get strictDeliveryEnforced(): boolean {
    return !!process.env.ZINTL_STRICT_SETTLE && !this.strictDeliveryExempt;
  }

  async waitForSettled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? 10000;
    const baseline = this.settleBaseline;

    if (baseline === undefined && this.strictDeliveryEnforced) {
      // No beacon at all — the runtime is not publishing __zintl_version, or
      // the page had not loaded it when the mutation began. Silently degrading
      // here is what made the old heuristic untrustworthy, so strict mode
      // treats an absent signal exactly like a stalled one.
      throw new Error(
        `[Lab] No runtime settle beacon was captured before the mutation. ` +
          `The page is not publishing __zintl_version.`,
      );
    }

    let confirmed = false;
    if (baseline !== undefined) {
      try {
        /**
         * `!==` rather than `>` on purpose: a full reload restarts the runtime
         * and resets the counter, so waiting for it to *grow* would hang until
         * timeout on exactly the updates that replace the whole page.
         */
        await this.page.waitForFunction(
          (v) => (globalThis as { __zintl_version?: number }).__zintl_version !== v,
          baseline,
          { timeout },
        );
        confirmed = true;
      } catch {
        /**
         * The runtime never reported settling. Normally fall through to the
         * heuristic — assertions are the better place to report a stall,
         * with the DOM state that explains it.
         *
         * `ZINTL_STRICT_SETTLE=1` turns this into a hard failure instead. Use
         * it to prove the beacon is genuinely wired: a silent fallback and a
         * working signal are otherwise indistinguishable, which is the exact
         * failure mode that made `waitForIdle` untrustworthy.
         */
        if (this.strictDeliveryEnforced) {
          throw new Error(
            `[Lab] Runtime settle beacon did not advance within ${timeout}ms ` +
              `(baseline ${baseline}). The runtime either never applied the change ` +
              `or is not publishing __zintl_version.`,
          );
        }
      }
      this.settleBaseline = undefined;
    }

    /**
     * The counter proves the store applied the change; frameworks still render
     * on their own schedule, so yield one frame for paint.
     *
     * Only one frame. The full idle heuristic — 500 ms of network silence plus
     * a fixed 100 ms — is the declared *fallback*, for when nothing causal
     * confirmed anything. Running it unconditionally meant every mutation in
     * the suite paid for a guess even when it had a reliable answer, and left
     * the suite unable to show how much of itself was genuinely synchronised.
     */
    if (confirmed) {
      await this.clock.waitForPaint();
    } else {
      await this.clock.waitForIdle({ timeout });
    }
  }

  async teardown(): Promise<void> {
    if (this.mode !== "project") {
      // stop loggin for now.
      // TODO: add a flag to enable/disable this.
      // try {
      //   const msgs = this.console.messages.filter((m) => m.type === "error" || m.type === "warn");
      //   if (msgs.length > 0) {
      //     console.log(`\n--- Browser Console Messages for ${this.exampleName} ---`);
      //     for (const m of msgs) {
      //       console.log(`[${m.type.toUpperCase()}] ${m.text}`);
      //     }
      //     console.log(`----------------------------------------------------\n`);
      //   }
      // } catch {}
    }
    try {
      /**
       * `teardown()` restores the original `ws.send`, so the interceptor is
       * gone and no listener can ever fire again. The `waitFor` that used to
       * follow this line could only ever time out — a guaranteed two-second
       * sleep on every browser lab teardown, dressed as a wait.
       */
      this.ws.teardown();
    } catch {}
    try {
      await this.fs.restoreAll();
    } catch (err) {
      console.error("[Teardown] Filesystem restore failed:", err);
    }
    // Strictly after restoreAll: a materialized project may own the directory
    // the filesystem is restoring into.
    try {
      await this.project.cleanup();
    } catch (err) {
      console.error("[Teardown] Project cleanup failed:", err);
    }
    try {
      await this.browser.close();
    } catch {}
  }
}

export async function createLab(opts: LabOptions): Promise<Lab> {
  if (!process.env.ZINTL_LOG_LEVEL) {
    process.env.ZINTL_LOG_LEVEL = "silent";
  }

  const project = await opts.source.materialize();

  const fs = new LabFilesystem(project.root);
  await fs.init();

  const mode = opts.mode ?? "dev";
  const port = opts.port ?? 0;
  const env = opts.env ?? {};

  let server: LabDevServer | LabPreviewServer;
  if (mode === "dev") {
    server = await createLabDevServer(project.root, opts.source.id, port, env, opts.driver);
  } else {
    server = await createLabPreviewServer(project.root, opts.source.id, port, env);
  }

  const browser = await createLabBrowser(opts.headless ?? true);

  // createLab is for browser-based tests — zintlOptions are not needed
  // for project-mode compilation, so we use an empty placeholder here.
  const lab = new LabImpl(
    browser.page,
    browser,
    server,
    server.url,
    project,
    mode,
    fs,
    opts.source.id,
    {},
  );
  lab.strictDeliveryExempt = opts.strictDeliveryExempt;

  return lab;
}

export async function createProjectLab(opts: ProjectLabOptions): Promise<Lab> {
  if (!process.env.ZINTL_LOG_LEVEL) {
    process.env.ZINTL_LOG_LEVEL = "silent";
  }

  const project = await opts.source.materialize();

  const fs = new LabFilesystem(project.root);
  await fs.init();

  const lab = new LabImpl(
    undefined,
    undefined,
    undefined,
    "",
    project,
    "project",
    fs,
    opts.source.id,
    opts.zintlOptions,
    opts.driver,
  );

  return lab;
}
