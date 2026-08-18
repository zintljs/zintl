import fs from "node:fs/promises";
import express from "express";
import http from "node:http";

// Constants
const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 5173;
const base = process.env.BASE || "/";

// Cached production assets
const templates = {};
if (isProduction) {
  for (const locale of ["en", "ar", "es", "zh"]) {
    try {
      templates[locale] = await fs.readFile(`./dist/client/${locale}/index.html`, "utf-8");
    } catch {}
  }
}

// Create http server
const app = express();
/**
 * An explicit http server, so Vite's HMR socket can share it.
 *
 * In middleware mode Vite has no server of its own to attach the HMR
 * WebSocket to, so unless it is handed one it opens a second listener on a
 * **fixed** port (24678). One fixed port is one process: a second SSR app
 * started alongside this one either fails to bind or answers the first
 * app's browser, and in both cases hot updates simply never arrive — the
 * server sends them and nothing is listening.
 *
 * `express()` is a request handler, not a server, so the handler has to be
 * wrapped before Vite is created and `httpServer.listen` replaces
 * `app.listen` at the bottom.
 */
const httpServer = http.createServer(app);

// Add Vite or respective production middlewares
/** @type {import('vite').ViteDevServer | undefined} */
let vite;
if (!isProduction) {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "custom",
    base,
  });
  app.use(vite.middlewares);
} else {
  const compression = (await import("compression")).default;
  const sirv = (await import("sirv")).default;
  app.use(compression());
  app.use(base, sirv("./dist/client", { extensions: [] }));
}

// Serve HTML
app.use("*all", async (req, res) => {
  try {
    const url = req.originalUrl.replace(base, "");
    const parts = url.split("/").filter(Boolean);
    const locales = ["en", "ar", "es", "zh"];

    if (url === "" || url === "/" || url === "index.html") {
      const acceptLang = req.headers["accept-language"] || "";
      const lang = acceptLang.split(",")[0].split("-")[0];
      const target = locales.includes(lang) ? lang : "en";
      return res.redirect(302, `${base}${target}/`);
    }

    /** @type {string} */
    let template;
    /** @type {import('./src/entry-server.ts').render} */
    let render;
    if (!isProduction) {
      // Always read fresh template in development
      template = await fs.readFile("./index.html", "utf-8");
      template = await vite.transformIndexHtml(url === "/" ? "/index.html" : url, template);
      render = (await vite.ssrLoadModule("/src/entry-server.ts")).render;
    } else {
      const locale = parts.length > 0 && locales.includes(parts[0]) ? parts[0] : "en";
      template = templates[locale] || templates["en"];
      render = (await import("./dist/server/entry-server.js")).render;
    }

    const rendered = await render(url);

    const html = template
      .replace(`<!--app-head-->`, rendered.head ?? "")
      .replace(`<!--app-html-->`, rendered.html ?? "");

    res.status(200).set({ "Content-Type": "text/html" }).send(html);
  } catch (e) {
    vite?.ssrFixStacktrace(e);
    console.log(e.stack);
    res.status(500).end(e.stack);
  }
});

// Start http server
httpServer.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
