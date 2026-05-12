import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZintlPluginContext } from "../context.js";

export function configureServerHook(ctx: ZintlPluginContext) {
  return function (server: ViteDevServer) {
    ctx.server = server;

    const multiplex = ctx.getMultiplex();
    if (multiplex) {
      const locales = ctx.options.locales || ["en"];
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "/";
        const [pathname] = url.split("?");

        // Match /locale/ or /locale/index.html
        const match = pathname.match(/^\/([a-z]{2})(\/index\.html|\/)?$/);
        if (match) {
          const locale = match[1];
          if (locales.includes(locale)) {
            const originalPath = join(server.config.root, "index.html");
            if (existsSync(originalPath)) {
              let html = readFileSync(originalPath, "utf-8");
              let dir = locale === "ar" ? "rtl" : "ltr";
              try {
                const catalogPath = ctx.compiler.html.getCatalogPath("index.html", locale);
                if (existsSync(catalogPath)) {
                  const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
                  const isMulti = ctx.compiler.isMultilingualFormat();
                  const catalogDir = isMulti ? cat.dir?.[locale] : cat.dir;
                  if (catalogDir !== undefined) {
                    dir = catalogDir;
                  }
                }
              } catch {}

              html = html.replace(/<html([^>]*)>/i, (m, attrs) => {
                let newAttrs = attrs;
                if (!/lang=/i.test(attrs)) newAttrs += ` lang="${locale}"`;
                else newAttrs = newAttrs.replace(/lang=["'][^"']*["']/i, `lang="${locale}"`);

                if (!/dir=/i.test(attrs)) newAttrs += ` dir="${dir}"`;
                else newAttrs = newAttrs.replace(/dir=["'][^"']*["']/i, `dir="${dir}"`);

                return `<html${newAttrs}>`;
              });

              html = html.replace(
                /(<script\s+[^>]*type=["']module["'][^>]*src=["'])([^"']*)(["'])/gi,
                (m, prefix, src, suffix) => {
                  if (
                    src.includes("node_modules") ||
                    src.startsWith("http") ||
                    src.startsWith("//")
                  ) {
                    return m;
                  }
                  const separator = src.includes("?") ? "&" : "?";
                  return `${prefix}${src}${separator}zintl-multiplex=${locale}${suffix}`;
                },
              );

              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html");
              return res.end(await server.transformIndexHtml(url, html));
            }
          }
        }

        if (pathname === "/" || pathname === "/index.html") {
          const defaultLocale = ctx.options.sourceLocale || "en";
          const localesStr = JSON.stringify(locales);
          const redirectHtml = `
<!doctype html>
<html>
  <head>
    <script>
      const lang = (navigator.language || '${defaultLocale}').split('-')[0];
      const supported = ${localesStr};
      const target = supported.includes(lang) ? lang : '${defaultLocale}';
      window.location.replace('/' + target + '/');
    </script>
  </head>
</html>`;
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          return res.end(redirectHtml);
        }

        next();
      });
    }
  };
}
