/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument */
import { build, preview } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import http from "node:http";

export interface LabPreviewServer {
  server: any;
  url: string;
  close(): Promise<void>;
}

export async function createLabPreviewServer(
  exampleRoot: string,
  port: number = 0,
  env: Record<string, string> = {},
): Promise<LabPreviewServer> {
  // Apply environment overrides
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const configFile = existsSync(join(exampleRoot, "vite.config.ts"))
    ? join(exampleRoot, "vite.config.ts")
    : undefined;

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
      await import(`file://${serverJsPath}?t=${Date.now()}`);
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

    return {
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

    return {
      server,
      url,
      async close() {
        await server.close();
      },
    };
  }
}
