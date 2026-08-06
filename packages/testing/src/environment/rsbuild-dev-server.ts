import type { DevServerDriver, LabDevServerHandle } from "./dev-server-driver.js";

/**
 * An Rsbuild dev server, for proposal 026.
 *
 * Deliberately offers no `interceptHmr`. Rsbuild pushes hot updates over its own
 * channel, and — more to the point — Zintl does not *support* hot updates on
 * this host: `rspackFacet` emits no acceptance code, because ZDB §7a makes dev
 * support conditional on two ordering guarantees that have not been established
 * here. Supplying a packet channel would suggest a story that does not exist.
 *
 * What this does buy is the thing nothing else covered: whether a Zintl app
 * built by Rspack actually *runs* — renders its source locale, switches locale,
 * resolves its catalogs — in a real browser. Every one of those contracts is
 * non-HMR, and none of them could reach this host before.
 */
export class RsbuildDevServerDriver implements DevServerDriver {
  readonly name = "rsbuild";

  async start(root: string, _projectName: string, port: number): Promise<LabDevServerHandle> {
    /**
     * Imported lazily, like `RsbuildDriver` does and for the same reason: this
     * module is reachable from the `@zintljs/testing` barrel, and a top-level
     * import would make every Vite contract pay to load Rspack's native binding.
     */
    const { createRsbuild, loadConfig } = await import("@rsbuild/core");

    const { content: fileConfig } = await loadConfig({ cwd: root });

    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        ...fileConfig,
        root,
        logLevel: "error",
        server: { ...(fileConfig as any)?.server, port: port || undefined, strictPort: !!port },
        dev: { ...(fileConfig as any)?.dev, progressBar: false },
      },
    });

    const server = await rsbuild.startDevServer();

    return {
      url: server.urls[0] ?? `http://localhost:${server.port}`,
      native: server,
      root,
      async close() {
        await server.server.close();
      },
    };
  }
}
