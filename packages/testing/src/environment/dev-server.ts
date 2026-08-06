import type { DriverKind } from "./driver.js";
import type { LabDevServerHandle } from "./dev-server-driver.js";
import { ViteDevServerDriver } from "./vite-dev-server.js";
import { RsbuildDevServerDriver } from "./rsbuild-dev-server.js";

export type LabDevServer = LabDevServerHandle;

/**
 * Dev servers already running in this worker, keyed by project name.
 *
 * Pooling is load-bearing rather than an optimisation: contracts mutate their
 * project and several contracts target the same project, so every lab for a
 * given project inside one worker must talk to the *same* server — which is
 * also why `copiedExampleSource` resolves that project to one root per worker.
 */
const sharedServers = new Map<string, LabDevServer>();

function driverFor(kind: DriverKind | undefined) {
  return kind === "rsbuild" ? new RsbuildDevServerDriver() : new ViteDevServerDriver();
}

export async function createLabDevServer(
  exampleRoot: string,
  exampleName: string,
  port: number = 0,
  env: Record<string, string> = {},
  driver?: DriverKind,
): Promise<LabDevServer> {
  const existing = sharedServers.get(exampleName);
  if (existing) {
    return existing;
  }

  // Apply environment overrides
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const devServer = await driverFor(driver).start(exampleRoot, exampleName, port);
  sharedServers.set(exampleName, devServer);
  return devServer;
}

export async function closeSharedServers(): Promise<void> {
  for (const server of sharedServers.values()) {
    try {
      await server.close();
    } catch (err) {
      console.error("[Teardown] Failed to close shared dev server:", err);
    }
  }
  sharedServers.clear();
}
