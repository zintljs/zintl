import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { configureServerHook } from "../hooks/server.ts";
import * as fs from "node:fs";

vi.mock("node:fs", async () => {
  const actual = (await vi.importActual("node:fs")) as any;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe("configureServerHook", () => {
  let ctx: any;
  let server: any;
  let middlewares: any[];

  beforeEach(() => {
    middlewares = [];
    server = {
      config: {
        root: "/mock-root",
      },
      middlewares: {
        use: vi.fn((mw) => {
          middlewares.push(mw);
        }),
      },
      transformIndexHtml: vi.fn(async (url, html) => {
        return `transformed:${html}`;
      }),
    };

    ctx = {
      options: {
        locales: ["en", "ar", "es"],
        sourceLocale: "en",
      },
      server: null,
      getMultiplex: vi.fn(() => true),
      compiler: {
        html: {
          getCatalogPath: vi.fn(() => "/mock-catalog.json"),
        },
        isMultilingualFormat: vi.fn(() => false),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should not register middleware if multiplex is disabled", () => {
    ctx.getMultiplex.mockReturnValue(false);
    const hook = configureServerHook(ctx);
    hook(server);

    expect(ctx.server).toBe(server);
    expect(server.middlewares.use).not.toHaveBeenCalled();
  });

  it("should register middleware if multiplex is enabled", () => {
    const hook = configureServerHook(ctx);
    hook(server);

    expect(ctx.server).toBe(server);
    expect(server.middlewares.use).toHaveBeenCalledTimes(1);
  });

  it("should handle redirect when request is / or /index.html", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    const req = { url: "/" };
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 0,
      setHeader: vi.fn((k, v) => {
        headers[k] = v;
      }),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(headers["Content-Type"]).toBe("text/html");
    expect(res.end).toHaveBeenCalled();
    const htmlContent = res.end.mock.calls[0][0];
    expect(htmlContent).toContain("window.location.replace");
    expect(htmlContent).toContain(`["en","ar","es"]`);
    expect(next).not.toHaveBeenCalled();

    // Now test with /index.html
    const reqIndex = { url: "/index.html" };
    res.end.mockClear();
    await mw(reqIndex, res, next);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should pass request to next() if path is not matched", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    const req = { url: "/some-other-path" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("should handle localized HTML routing when file does not exist", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    // Mock existsSync to return false for the file path
    (fs.existsSync as any).mockReturnValue(false);

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(fs.existsSync).toHaveBeenCalledWith("/mock-root/about.html");
    expect(next).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("should handle localized HTML routing when file exists but catalog does not", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    // existsSync true for HTML file, false for catalog
    (fs.existsSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) return true;
      if (path.endsWith("catalog.json")) return false;
      return false;
    });

    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html><head><script type="module" src="main.ts"></script></head><body>hello</body></html>`;
      }
      return "";
    });

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalled();
    const resultHtml = res.end.mock.calls[0][0];
    expect(resultHtml).toContain("transformed:");
    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/ar/about.html",
      `<html lang="ar" dir="rtl"><head><script type="module" src="main.ts?zintl-multiplex=ar"></script></head><body>hello</body></html>`,
    );
  });

  it("should handle localized HTML routing when catalog exists in non-multilingual format", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    (fs.existsSync as any).mockReturnValue(true);

    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html><head><script type="module" src="main.ts"></script></head><body>hello</body></html>`;
      }
      if (path.endsWith("catalog.json")) {
        return JSON.stringify({ dir: "ltr" });
      }
      return "";
    });

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/ar/about.html",
      `<html lang="ar" dir="ltr"><head><script type="module" src="main.ts?zintl-multiplex=ar"></script></head><body>hello</body></html>`,
    );
  });

  it("should handle localized HTML routing when catalog exists in multilingual format", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    ctx.compiler.isMultilingualFormat.mockReturnValue(true);
    (fs.existsSync as any).mockReturnValue(true);

    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html><head><script type="module" src="main.ts"></script></head><body>hello</body></html>`;
      }
      if (path.endsWith("catalog.json")) {
        return JSON.stringify({ dir: { ar: "rtl", es: "ltr" } });
      }
      return "";
    });

    const req = { url: "/es/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/es/about.html",
      `<html lang="es" dir="ltr"><head><script type="module" src="main.ts?zintl-multiplex=es"></script></head><body>hello</body></html>`,
    );
  });

  it("should not rewrite script tags targeting node_modules or absolute/protocol URLs", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    (fs.existsSync as any).mockImplementation((path: string) => {
      return path.endsWith("about.html");
    });

    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html><head>
          <script type="module" src="node_modules/dep/index.js"></script>
          <script type="module" src="https://example.com/cdn.js"></script>
          <script type="module" src="//example.com/cdn2.js"></script>
          <script type="module" src="src/app.ts?query=1"></script>
        </head><body>hello</body></html>`;
      }
      return "";
    });

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/ar/about.html",
      `<html lang="ar" dir="rtl"><head>
          <script type="module" src="node_modules/dep/index.js"></script>
          <script type="module" src="https://example.com/cdn.js"></script>
          <script type="module" src="//example.com/cdn2.js"></script>
          <script type="module" src="src/app.ts?query=1&zintl-multiplex=ar"></script>
        </head><body>hello</body></html>`,
    );
  });

  it("should handle error during catalog reading gracefully", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html><head><script type="module" src="main.ts"></script></head><body>hello</body></html>`;
      }
      if (path.endsWith("catalog.json")) {
        throw new Error("Disk error");
      }
      return "";
    });

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    // Should not throw, should use default dir
    await mw(req, res, next);

    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/ar/about.html",
      `<html lang="ar" dir="rtl"><head><script type="module" src="main.ts?zintl-multiplex=ar"></script></head><body>hello</body></html>`,
    );
  });

  it("should handle existing lang and dir attributes in html tag", async () => {
    const hook = configureServerHook(ctx);
    hook(server);
    const mw = middlewares[0];

    (fs.existsSync as any).mockImplementation((path: string) => {
      return path.endsWith("about.html");
    });

    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.endsWith("about.html")) {
        return `<html lang="fr" dir="ltr"><head></head><body>hello</body></html>`;
      }
      return "";
    });

    const req = { url: "/ar/about.html" };
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    await mw(req, res, next);

    expect(server.transformIndexHtml).toHaveBeenCalledWith(
      "/ar/about.html",
      `<html lang="ar" dir="rtl"><head></head><body>hello</body></html>`,
    );
  });
});
