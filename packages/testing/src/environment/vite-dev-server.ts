/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import { createServer } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";
import type { DevServerDriver, LabDevServerHandle } from "./dev-server-driver.js";
import type { HmrPacket } from "./websocket.js";

/**
 * Patch Vite's hot-update channel so the lab can watch what the server pushes.
 *
 * This lived inside `LabWebSocket` and reached into `server.ws` directly, which
 * is exactly the kind of host knowledge the driver seam exists to hold. Moving
 * it here means `LabWebSocket` no longer knows what a `ViteDevServer` is, and a
 * host without a patchable channel simply does not supply this function.
 */
function interceptViteHmr(server: any, onPacket: (packet: HmrPacket) => void): () => void {
  const ws = server.ws;
  const originalSend = ws.send;

  ws.send = (payload: any, ...args: any[]) => {
    try {
      const data = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (data && typeof data.type === "string") {
        onPacket({ type: data.type, timestamp: Date.now(), data });
      }
    } catch {
      // A payload we cannot parse is still a payload the server sent; losing
      // the record is preferable to breaking delivery.
    }
    return originalSend.call(ws, payload, ...args);
  };

  return () => {
    ws.send = originalSend;
  };
}

export class ViteDevServerDriver implements DevServerDriver {
  readonly name = "vite";

  async start(
    exampleRoot: string,
    _projectName: string,
    port: number,
  ): Promise<LabDevServerHandle> {
    let handle: LabDevServerHandle;
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

      handle = {
        native: viteServer,
        root: exampleRoot,
        url,
        interceptHmr: (onPacket) => interceptViteHmr(viteServer, onPacket),
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

      handle = {
        native: server,
        root: exampleRoot,
        url,
        interceptHmr: (onPacket) => interceptViteHmr(server, onPacket),
        async close() {
          await server.close();
        },
      };
    }

    return handle!;
  }
}
