/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import { createServer, type ViteDevServer } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";

export interface LabDevServer {
  server: ViteDevServer;
  url: string;
  close(): Promise<void>;
}

export async function createLabDevServer(
  exampleRoot: string,
  port: number = 0,
  env: Record<string, string> = {},
): Promise<LabDevServer> {
  // Apply environment overrides
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const targetPort = port || 0;
  const serverJsPath = join(exampleRoot, "server.js");
  const hasCustomServer = existsSync(serverJsPath);

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
      await import(`file://${serverJsPath}?t=${Date.now()}`);
    } finally {
      // Restore listen patch immediately, but keep process.chdir active for async handlers
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

    return {
      server: viteServer,
      url,
      async close() {
        await new Promise<void>((resolve, reject) => {
          capturedHttpServer!.close((err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
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

    return {
      server,
      url,
      async close() {
        await server.close();
      },
    };
  }
}
