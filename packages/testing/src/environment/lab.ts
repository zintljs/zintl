import type { Page } from "@playwright/test";
import { createLabBrowser, type LabBrowser } from "./browser.js";
import { createLabDevServer, type LabDevServer } from "./dev-server.js";
import { createLabPreviewServer, type LabPreviewServer } from "./preview-server.js";
import { LabFilesystem } from "./filesystem.js";
import { LabCompiler } from "./compiler.js";
import { LabWebSocket } from "./websocket.js";
import { LabNetwork } from "./network.js";
import { LabConsole } from "./console.js";
import { LabClock } from "./clock.js";
import { LabAssertions } from "../assertions/index.js";
import { LabPipeline } from "./pipeline.js";
import type { ZintlPluginOptions } from "./driver.js";
import { ViteDriver } from "./vite-driver.js";
import type { MaterializedProject, ProjectSource } from "../contracts/source.js";

export interface LabOptions {
  source: ProjectSource;
  mode?: "dev" | "preview";
  port?: number;
  env?: Record<string, string>;
  headless?: boolean;
}

export interface ProjectLabOptions {
  source: ProjectSource;
  zintlOptions: ZintlPluginOptions;
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
  readonly driver: ViteDriver;
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
  readonly driver: ViteDriver;
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

    const devServer = mode === "dev" ? (server as LabDevServer).server : undefined;
    this.ws = mode === "project" ? throwNoAccess("ws") : new LabWebSocket(devServer);
    this.network = mode === "project" ? throwNoAccess("network") : new LabNetwork(this.page);
    this.console = mode === "project" ? throwNoAccess("console") : new LabConsole(this.page);
    this.clock = mode === "project" ? throwNoAccess("clock") : new LabClock(this.page);
    this.compiler = new LabCompiler(devServer);
    this.assert = new LabAssertions(this);
    this.pipeline = new LabPipeline(exampleName, root, zintlOptions);
    this.driver = this.pipeline.driver;

    const beforeMutation = async () => {
      if (mode !== "project") {
        this.settleBaseline = await this.readSettleCounter();
      }
    };

    const onMutation = async () => {
      if (mode === "dev") {
        try {
          await Promise.race([
            this.ws.waitFor("update", { timeout: 4000 }),
            this.ws.waitFor("full-reload", { timeout: 4000 }),
          ]);
        } catch {
          // No HMR packet — waitForSettled below still gates on the runtime.
        }
        await this.waitForSettled();
      }
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

  async waitForSettled(opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? 10000;
    const baseline = this.settleBaseline;

    if (baseline === undefined && process.env.ZINTL_STRICT_SETTLE) {
      // No beacon at all — the runtime is not publishing __zintl_version, or
      // the page had not loaded it when the mutation began. Silently degrading
      // here is what made the old heuristic untrustworthy, so strict mode
      // treats an absent signal exactly like a stalled one.
      throw new Error(
        `[Lab] No runtime settle beacon was captured before the mutation. ` +
          `The page is not publishing __zintl_version.`,
      );
    }

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
        if (process.env.ZINTL_STRICT_SETTLE) {
          throw new Error(
            `[Lab] Runtime settle beacon did not advance within ${timeout}ms ` +
              `(baseline ${baseline}). The runtime either never applied the change ` +
              `or is not publishing __zintl_version.`,
          );
        }
      }
      this.settleBaseline = undefined;
    }

    // The counter proves the store applied the change; frameworks still render
    // on their own schedule, so yield one frame for paint.
    await this.clock.waitForIdle({ timeout });
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
      this.ws.teardown();
      await this.ws.waitFor("update", { timeout: 2000 });
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
    server = await createLabDevServer(project.root, opts.source.id, port, env);
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
  );

  return lab;
}
