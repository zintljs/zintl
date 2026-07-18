/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import { createServer, type ViteDevServer } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";

export interface LabDevServer {
  server: ViteDevServer;
  url: string;
  close(): Promise<void>;
}
const sharedServers = new Map<string, LabDevServer>();

export async function createLabDevServer(
  exampleRoot: string,
  exampleName: string,
  port: number = 0,
  env: Record<string, string> = {},
): Promise<LabDevServer> {
  const existing = sharedServers.get(exampleName);
  if (existing) {
    return existing;
  }

  // Apply environment overrides
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const targetPort = port || 0;
  const serverJsPath = join(exampleRoot, "server.js");
  const hasCustomServer = existsSync(serverJsPath);

  let devServer: LabDevServer;

  if (hasCustomServer) {
    const originalChdir = process.cwd();
    process.chdir(exampleRoot);

    let capturedHttpServer: any = null;
    const originalListen = http.Server.prototype.listen;
    (http.Server.prototype as any).listen = function (this: http.Server, ...args: any[]) {
      capturedHttpServer = this;
      return (originalListen as any).apply(this, args);
    };

    process.env.PORT = String(targetPort);

    try {
      await import(`${pathToFileURL(serverJsPath).href}?t=${Date.now()}`);
      // Wait up to 5 seconds for listen() to be called in server.js
      for (let i = 0; i < 50; i++) {
        if (capturedHttpServer) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      // Restore listen patch
      http.Server.prototype.listen = originalListen;
    }

    if (!capturedHttpServer) {
      process.chdir(originalChdir);
      throw new Error(`Custom server script at ${serverJsPath} did not call listen()`);
    }

    const contexts = (globalThis as any).__zintl_active_contexts || [];
    const activeContext = contexts[contexts.length - 1];

    if (!activeContext) {
      process.chdir(originalChdir);
      throw new Error(`Custom server at ${serverJsPath} did not instantiate Zintl plugin`);
    }

    let viteServer = activeContext.server;
    if (!viteServer) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        viteServer = activeContext.server;
        if (viteServer) break;
      }
    }

    if (!viteServer) {
      process.chdir(originalChdir);
      throw new Error(`ViteDevServer not found on Zintl context from ${serverJsPath}`);
    }

    const address = capturedHttpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : 5173;
    const url = `http://localhost:${actualPort}`;

    devServer = {
      server: viteServer,
      url,
      async close() {
        if (capturedHttpServer) {
          if (typeof (capturedHttpServer as any).closeAllConnections === "function") {
            (capturedHttpServer as any).closeAllConnections();
          }
          await new Promise<void>((resolve, reject) => {
            capturedHttpServer!.close((err: any) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        await viteServer!.close();
        // Restore CWD when closing the server
        process.chdir(originalChdir);
      },
    };
  } else {
    const server = await createServer({
      logLevel: "silent",
      root: exampleRoot,
      server: {
        port: targetPort || undefined,
        strictPort: !!targetPort,
        host: "localhost",
      },
      configFile: existsSync(join(exampleRoot, "vite.config.ts"))
        ? join(exampleRoot, "vite.config.ts")
        : undefined,
    });

    await server.listen();

    const address = server.httpServer?.address();
    const actualPort = typeof address === "object" && address ? address.port : 5173;
    const url = `http://localhost:${actualPort}`;

    devServer = {
      server,
      url,
      async close() {
        await server.close();
      },
    };
  }

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
