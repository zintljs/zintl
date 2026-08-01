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

    const onMutation = async () => {
      if (mode === "dev") {
        try {
          await Promise.race([
            this.ws.waitFor("update", { timeout: 4000 }),
            this.ws.waitFor("full-reload", { timeout: 4000 }),
          ]);
        } catch {
          // Fallback to time wait if no HMR packet or timeout
        }
        await this.clock.waitForIdle();
      }
    };

    this.fs = fs;
    this.fs.setMutationCallback(onMutation);
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
