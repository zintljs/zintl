import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMonorepoRoot(startDir: string): string {
  const markers = ["pnpm-workspace.yaml", "pnpm-lock.yaml"];
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (markers.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const MONOREPO_ROOT = findMonorepoRoot(__dirname);

export interface LabOptions {
  example: string;
  mode?: "dev" | "preview";
  port?: number;
  env?: Record<string, string>;
  headless?: boolean;
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
  readonly url: string;
  readonly root: string;

  constructor(
    page: Page,
    browser: LabBrowser,
    server: LabDevServer | LabPreviewServer,
    url: string,
    root: string,
    mode: "dev" | "preview",
    fs: LabFilesystem,
  ) {
    this.page = page;
    this.browser = browser;
    this.server = server;
    this.url = url;
    this.root = root;

    const devServer = mode === "dev" ? (server as LabDevServer).server : undefined;
    this.ws = new LabWebSocket(devServer);
    this.network = new LabNetwork(page);
    this.console = new LabConsole(page);
    this.clock = new LabClock(page);
    this.compiler = new LabCompiler(devServer);
    this.assert = new LabAssertions(this);

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
    this.ws.teardown();
    await this.browser.close();
    await this.server.close();
    await this.fs.restoreAll();
  }
}

export async function createLab(opts: LabOptions): Promise<Lab> {
  if (!process.env.ZINTL_LOG_LEVEL) {
    process.env.ZINTL_LOG_LEVEL = "silent";
  }

  const root = join(MONOREPO_ROOT, "examples", opts.example);
  if (!existsSync(root)) {
    throw new Error(`Example fixture directory not found: ${opts.example}`);
  }

  const fs = new LabFilesystem(root);
  await fs.init();

  const mode = opts.mode ?? "dev";
  const port = opts.port ?? 0;
  const env = opts.env ?? {};

  let server: LabDevServer | LabPreviewServer;
  if (mode === "dev") {
    server = await createLabDevServer(root, port, env);
  } else {
    server = await createLabPreviewServer(root, port, env);
  }

  const browser = await createLabBrowser(opts.headless ?? true);

  const lab = new LabImpl(browser.page, browser, server, server.url, root, mode, fs);

  return lab;
}
