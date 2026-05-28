import fs from "node:fs/promises";
import express from "express";

// Constants
const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 5173;
const base = process.env.BASE || "/";

// Cached production assets
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

// Add Vite or respective production middlewares
/** @type {import('vite').ViteDevServer | undefined} */
let vite;
if (!isProduction) {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
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
      template = await vite.transformIndexHtml(url, template);
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
app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
