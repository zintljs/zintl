import { fixtureSource, type ProjectManifest, type ZintlPluginOptions } from "@zintljs/testing";

const zintlOptions: ZintlPluginOptions = {
  sourceLocale: "en",
  locales: ["en", "ar", "es", "zh"],
};

/**
 * A server entry that renders **asynchronously**, into a stream.
 *
 * Both properties are the point, and neither is available anywhere else in the
 * manifest:
 *
 * - **The `await` inside the render.** `runInRequestScope` assigns
 *   `globalThis.__zintl_active` and then runs the callback inside an
 *   `AsyncLocalStorage` scope. With a synchronous render — which is what all
 *   four SSR examples do — nothing can interleave between those two, so reading
 *   the request-scoped store and reading the process-global are indistinguishable
 *   and a leak is unobservable. One yield opens the window.
 *
 * - **The `ReadableStream` return.** `injectBakedCatalogs` routes a stream
 *   through `injectIntoStream`, machinery that ships in every SSR build and had
 *   no test touching it at all.
 *
 * The translated strings are deliberately produced *after* the yield, because
 * that is where a contaminated read would occur. Building them before it would
 * make the fixture look like it exercised the window while proving nothing.
 */
const entryServer = `import { zintl } from "zintljs/macro";

export async function render(url) {
  const locale = String(url || "").split("/").filter(Boolean)[0] || "en";
  await zintl(locale);

  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode('<!doctype html><html lang="' + locale + '"><head></head><body>'),
      );

      // The yield. Another request enters its own scope here and overwrites the
      // process-global that the non-ALS fallback reads.
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Built *after* the yield, on purpose: this is where a contaminated read
      // would happen. A template literal carrying markup is what the extractor
      // stitches, which is why the shape matters and a bare argument to
      // \`encoder.encode\` would extract nothing at all.
      const page = {
        text: \`<h1>Get started</h1>\`,
      };
      controller.enqueue(encoder.encode(page.text));

      controller.enqueue(encoder.encode('</body></html>'));
      controller.close();
    },
  });
}
`;

/**
 * Deliberately dependency-free: `vite.middlewares` is a connect instance, so a
 * bare `node:http` server can host it without pulling express into a fixture.
 */
const server = `import http from "node:http";
import { createServer } from "vite";

const port = Number(process.env.PORT || 0);

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});

const app = http.createServer((req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      const { render } = await vite.ssrLoadModule("/src/entry-server.js");
      const stream = await render(req.url || "/");

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");

      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      vite.ssrFixStacktrace?.(err);
      res.statusCode = 500;
      res.end(String(err && err.stack ? err.stack : err));
    }
  });
});

app.listen(port);
`;

const viteConfig = `import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  logLevel: "silent",
  plugins: [zintl(${JSON.stringify(zintlOptions, null, 2)})],
});
`;

export const ssrStreaming: ProjectManifest = {
  name: "ssr-streaming",
  source: fixtureSource({
    id: "ssr-streaming",
    zintlOptions,
    files: {
      "vite.config.ts": viteConfig,
      "server.js": server,
      "src/entry-server.js": entryServer,
      "zintl/src/entry-server.render.ar.json": JSON.stringify(
        { "Get started": "ابدأ الآن" },
        null,
        2,
      ),
      "zintl/src/entry-server.render.es.json": JSON.stringify(
        { "Get started": "Comienza ahora" },
        null,
        2,
      ),
      "zintl/src/entry-server.render.zh.json": JSON.stringify(
        { "Get started": "开始使用" },
        null,
        2,
      ),
      "index.html": `<!doctype html><html><body><div id="app"></div></body></html>\n`,
      "package.json": JSON.stringify(
        { name: "ssr-streaming", private: true, type: "module" },
        null,
        2,
      ),
    },
  }),
  zintlOptions,
  /**
   * `ssr`, plus the one hot-update guarantee this shape can actually prove.
   *
   * A fixture exists to answer one question, and claiming `hmr` would pull it
   * into browser contracts it has no UI for — there is no client script here at
   * all, so nothing would install `__zintl_current_instance` for the delivery
   * contracts to drive. `hmr-server-refresh` is deliberately *not* gated on
   * `hmr` for exactly that reason.
   *
   * It is the purest claimant ZHMR §4.3 has. The heading lives in
   * `src/entry-server.js` and nowhere else, so the edited boundary is in
   * `ssrBoundaries` and absent from `clientBoundaries` — the precise condition
   * that makes a hot update unaddressable and the full-reload broadcast the
   * only way the browser can learn anything.
   */
  capabilities: ["ssr", "hmr-server-refresh"],
  adapter: {
    headingSelector: "h1",
    initialHeadingText: "Get started",
    headingFile: "src/entry-server.js",
    ssrPath: (locale) => `/${locale}/`,
    navigateHome: async (lab) => {
      await lab.page.goto(`${lab.url}/en/`);
    },
    serverOnlyEdit: {
      file: "src/entry-server.js",
      find: "Get started",
      replaceWith: "Server refreshed",
    },
  },
};
