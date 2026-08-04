import type { ViteDevServer } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Context from "../context.js";
import type { HtmlManager } from "@zintljs/compiler/facets";

export function configureServerHook(ctx: Context) {
  return function (server: ViteDevServer) {
    ctx.server = server;

    /**
     * Deletions, which reach the plugin through no other route.
     *
     * The bundler handles `unlink` separately from `change`: it removes the
     * module from its graph and reloads, but never calls `handleHotUpdate` or
     * `hotUpdate`. Without this listener the compiler simply never learns, and
     * the deleted boundary stays in its graph and manifest for the life of the
     * process.
     *
     * Registered **before** the `appType === "custom"` return below. That early
     * exit skips the multiplex middleware, which SSR apps do not want — but they
     * do want their deletions noticed, and putting this after it would leave
     * every SSR project with the bug this listener exists to fix.
     *
     * Optional-chained because a server without a watcher has no deletions to
     * report: a build-mode server, or a test double that only models the parts
     * of the interface it cares about.
     */
    server.watcher?.on?.("unlink", (file: string) => {
      void ctx.compiler.removeFile(file).catch((err: unknown) => {
        ctx.compiler._logger
          .withPrefix("Vite")
          .error(`Failed to forget deleted file ${file}: ${String(err)}`);
      });
    });

    if (server.config?.appType === "custom") {
      return;
    }

    const multiplex = ctx.getMultiplex();
    if (multiplex) {
      const locales = ctx.options.locales;
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "/";
        const [pathname] = url.split("?");

        // Generic Multi-Page Support: Match /locale/pagePath
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length > 0 && locales.includes(parts[0])) {
          const locale = parts[0];
          const pagePath = parts.slice(1).join("/");
          const htmlFilename = pagePath || "index.html";
          const originalPath = join(server.config.root, htmlFilename);
          if (existsSync(originalPath)) {
            let html = readFileSync(originalPath, "utf-8");
            let dir = locale === "ar" ? "rtl" : "ltr";
            try {
              const catalogPath = (ctx.compiler.html as HtmlManager).getCatalogPath(
                htmlFilename,
                locale,
              );
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

        if (pathname === "/" || pathname === "/index.html") {
          const defaultLocale = ctx.options.sourceLocale;
          const localesStr = JSON.stringify(locales);
          const redirectHtml = `
<!doctype html>
<html>
  <head>
    <script>
      (function() {
        try {
          const lang = (navigator.language || '${defaultLocale}').split('-')[0];
          const supported = ${localesStr};
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts.length > 0 && supported.includes(parts[0])) return;
          const target = supported.includes(lang) ? lang : '${defaultLocale}';
          const path = window.location.pathname.replace(/^\\/+/, '');
          window.location.replace('/' + target + '/' + path + window.location.search + window.location.hash);
        } catch (e) {
          const supported = ${localesStr};
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts.length > 0 && supported.includes(parts[0])) return;
          const path = window.location.pathname.replace(/^\\/+/, '');
          window.location.replace('/${defaultLocale}/' + path);
        }
      })();
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
