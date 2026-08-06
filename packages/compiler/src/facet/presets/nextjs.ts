import type { ZintlFacet, SsrWrapParams, TargetDescriptor } from "@zintljs/compiler";

// ── Next.js SSR wrapping helper ───────────────────────────────────────────────

/**
 * Wraps the render function in a Next.js/vinext SSR entry file
 * with runInRequestScope for per-request locale isolation.
 */
function nextjsSsrWrapCode(params: SsrWrapParams): string | undefined {
  const { code, fileId, isEntry, locales, sourceLocale } = params;

  if (
    !isEntry &&
    !fileId.endsWith("entry-server") &&
    !fileId.endsWith("entry-server.ts") &&
    !fileId.endsWith("entry-server.js") &&
    !fileId.endsWith("entry-server.tsx") &&
    !fileId.endsWith("entry-server.jsx")
  ) {
    return undefined;
  }

  if (code.includes("_zintl_raw_render") || code.includes("_zintl_runInRequestScope")) {
    return undefined;
  }

  const localesStr = JSON.stringify(locales);
  const defaultLocaleStr = JSON.stringify(sourceLocale || "en");

  // Case 1: export function render(...)
  const funcRegex = /export\s+(async\s+)?function\s+render\b/;
  if (funcRegex.test(code)) {
    let res = code.replace(
      /export\s+(async\s+)?function\s+render\b/,
      "async function _zintl_raw_render",
    );
    res += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "virtual:zintl/runtime/internal";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
    return res;
  }

  // Case 2: export { render } or export { foo as render }
  const exportBlockRegex = /export\s*\{([^}]+)\}/g;
  let match;
  let found = false;
  let res = code;
  while ((match = exportBlockRegex.exec(code)) !== null) {
    const content = match[1];
    if (/\brender\b/.test(content)) {
      const parts = content.split(",").map((p) => p.trim());
      const index = parts.findIndex(
        (p) => p === "render" || p.startsWith("render as ") || p.endsWith(" as render"),
      );
      if (index !== -1) {
        const part = parts[index];
        if (part === "render") {
          parts[index] = "render as _zintl_raw_render";
          found = true;
        } else if (part.endsWith(" as render")) {
          const localName = part.substring(0, part.length - " as render".length).trim();
          parts[index] = `${localName} as _zintl_raw_render`;
          found = true;
        }
        if (found) {
          const newBlock = `export { ${parts.join(", ")} }`;
          res = res.replace(match[0], newBlock);
          res += `\n\nimport { runInRequestScope as _zintl_runInRequestScope } from "virtual:zintl/runtime/internal";\nexport async function render(urlOrReq, ...args) {\n  return _zintl_runInRequestScope([urlOrReq, ...args], ${localesStr}, ${defaultLocaleStr}, () => _zintl_raw_render(urlOrReq, ...args));\n}`;
          break;
        }
      }
    }
  }
  if (found) return res;

  return undefined;
}

// ── Next.js Contributions ─────────────────────────────────────────────────────

export interface NextjsExtractionOptions {
  /**
   * Replace the attributes scanned for strings, on top of what
   * {@link reactExtractionFacet} already covers.
   *
   * @default `aria-label` and `aria-description`
   */
  targets?: TargetDescriptor[];
  /**
   * File extensions this facet claims.
   *
   * @default none — React's `.tsx`/`.jsx` already cover Next.js files
   */
  extensions?: string[];
}

export interface NextjsSsrOptions {
  /**
   * Modules to treat as server entries.
   *
   * @default the `vinext` RSC, server and app-SSR virtual entries
   */
  entryTargets?: string[];
  /**
   * Named exports of the server entry to wrap in a request scope.
   *
   * @default `renderPage`, `handleApiRoute`, `runMiddleware`, `handleSsr`
   */
  wrapExports?: string[];
  /**
   * Also wrap the default export. `"fetch"` wraps its `fetch` method.
   *
   * @default "fetch"
   */
  wrapDefault?: "fetch" | boolean;
}

export interface NextjsRuntimeOptions {
  /**
   * Scope the active locale to the request, via `AsyncLocalStorage`.
   *
   * @default true
   */
  serverRequestScope?: boolean;
  /**
   * Rewrite `<html lang>`/`dir` in the outgoing HTML response or stream.
   *
   * @default true
   */
  streamInjection?: boolean;
}

/** Options for {@link nextjsFacet}, split across its three halves. */
export interface NextjsFacetOptions
  extends NextjsExtractionOptions, NextjsSsrOptions, NextjsRuntimeOptions {}

/**
 * Next.js extraction adjustments, layered on top of React's.
 *
 * Its real job is a suppression rule: `metadata`, `viewport`,
 * `generateMetadata` and `generateViewport` are build-time exports, not UI, so
 * their strings are left alone — unless you put a `zintl()` anchor in one, which
 * is a clear enough statement of intent to bypass the rule.
 *
 * One third of {@link nextjsFacet}.
 */
export function nextjsExtractionFacet(options: NextjsExtractionOptions = {}): ZintlFacet {
  return {
    name: "nextjs-extraction",
    when: { framework: "nextjs" },
    concern: "extraction",
    priority: 100,
    targets: (options.targets || [
      "jsx:*:aria-label",
      "jsx:*:aria-description",
    ]) as TargetDescriptor[],
    extensions: options.extensions || [],
    suppressionRules: [
      {
        match: {
          types: ["FunctionDeclaration", "VariableDeclarator"],
          names: ["generateMetadata", "generateViewport", "metadata", "viewport"],
          isTopLevel: true,
        },
        bypassIf: "hasAnchor",
      },
    ],
  };
}

/**
 * Request-scope wrapping for Next.js server entries.
 *
 * Targets the framework's own entries — RSC, server, app-SSR — instead of the
 * conventional `entry-server`, which is why the generic SSR facet is left out
 * when this one is installed.
 *
 * One third of {@link nextjsFacet}.
 */
export function nextjsSsrFacet(options: NextjsSsrOptions = {}): ZintlFacet {
  return {
    name: "nextjs-ssr-wrapping",
    when: { framework: "nextjs" },
    provides: ["ssr:wrapping"],
    supersedes: ["ssr:wrapping"],
    concern: "ssr",
    priority: 100,
    entryTargets: options.entryTargets || [
      "virtual:vinext-rsc-entry",
      "virtual:vinext-server-entry",
      "virtual:vinext-app-ssr-entry",
      "app-ssr-entry",
    ],
    wrapCode: nextjsSsrWrapCode,
    wrapExports: options.wrapExports || [
      "renderPage",
      "handleApiRoute",
      "runMiddleware",
      "handleSsr",
    ],
    wrapDefault: options.wrapDefault !== undefined ? options.wrapDefault : "fetch",
  };
}

/**
 * The server-side runtime for Next.js: per-request locale scoping and HTML
 * injection. Same capabilities as the generic SSR runtime.
 *
 * One third of {@link nextjsFacet}.
 */
export function nextjsRuntimeFacet(options: NextjsRuntimeOptions = {}): ZintlFacet {
  return {
    name: "nextjs-runtime",
    when: { framework: "nextjs" },
    supersedes: ["ssr-runtime", "client-spa"],
    concern: "runtime",
    priority: 100,
    serverRequestScope:
      options.serverRequestScope !== undefined ? options.serverRequestScope : true,
    streamInjection: options.streamInjection !== undefined ? options.streamInjection : true,
  };
}

/**
 * Full Next.js support: {@link nextjsExtractionFacet}, {@link nextjsSsrFacet}
 * and {@link nextjsRuntimeFacet}.
 *
 * Layered on top of React rather than replacing it — the built-in set installs both
 * when Next.js is detected, and skips the generic SSR and client-SPA facets,
 * whose jobs Next.js does itself.
 */
export function nextjsFacet(options: NextjsFacetOptions = {}): ZintlFacet[] {
  return [nextjsExtractionFacet(options), nextjsSsrFacet(options), nextjsRuntimeFacet(options)];
}
