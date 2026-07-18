/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import { build, preview } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";

export interface LabPreviewServer {
  server: any;
  url: string;
  close(): Promise<void>;
}
const sharedPreviewServers = new Map<string, LabPreviewServer>();

export async function createLabPreviewServer(
  exampleRoot: string,
  exampleName: string,
  port: number = 0,
  env: Record<string, string> = {},
): Promise<LabPreviewServer> {
  const existing = sharedPreviewServers.get(exampleName);
  if (existing) {
    return existing;
  }

  // Apply environment overrides
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const configFile = existsSync(join(exampleRoot, "vite.config.ts"))
    ? join(exampleRoot, "vite.config.ts")
    : undefined;

  let previewServer: LabPreviewServer;

  // Run production build
  await build({
    root: exampleRoot,
    configFile,
    logLevel: "error",
  });

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

    process.env.NODE_ENV = "production";
    process.env.PORT = String(port || 0);

    try {
      await import(`${pathToFileURL(serverJsPath).href}?t=${Date.now()}`);
    } finally {
      http.Server.prototype.listen = originalListen;
    }

    if (!capturedHttpServer) {
      process.chdir(originalChdir);
      throw new Error(`Custom server script did not call listen() in preview mode`);
    }

    const address = capturedHttpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : 4173;
    const url = `http://localhost:${actualPort}`;

    previewServer = {
      server: capturedHttpServer,
      url,
      async close() {
        await new Promise<void>((resolve, reject) => {
          capturedHttpServer!.close((err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        process.chdir(originalChdir);
      },
    };
  } else {
    // Standard Vite preview server
    const server = await preview({
      root: exampleRoot,
      preview: {
        port: port || undefined,
        strictPort: !!port,
        host: "localhost",
      },
      configFile,
    });

    const address = server.httpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : 4173;
    const url = `http://localhost:${actualPort}`;

    previewServer = {
      server,
      url,
      async close() {
        await server.close();
      },
    };
  }

  sharedPreviewServers.set(exampleName, previewServer);
  return previewServer;
}

export async function closeSharedPreviewServers(): Promise<void> {
  for (const server of sharedPreviewServers.values()) {
    try {
      await server.close();
    } catch (err) {
      console.error("[Teardown] Failed to close shared preview server:", err);
    }
  }
  sharedPreviewServers.clear();
}
