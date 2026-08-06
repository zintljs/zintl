import type { ZintlFacet, SsrWrapParams } from "@zintljs/compiler";

function genericSsrWrapCode(params: SsrWrapParams): string | undefined {
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

export interface SsrWrappingOptions {
  /**
   * Modules to treat as server entries.
   *
   * @default the conventional `entry-server.{ts,js,tsx,jsx}`
   */
  entryTargets?: string[];
  /**
   * Named exports of the server entry to wrap in a request scope.
   *
   * @default the `render` export
   */
  wrapExports?: string[];
  /**
   * Also wrap the default export. `"fetch"` wraps its `fetch` method, for
   * entries that export a server object rather than a function.
   *
   * @default false
   */
  wrapDefault?: "fetch" | boolean;
}

export interface SsrRuntimeOptions {
  /**
   * Scope the active locale to the request, via `AsyncLocalStorage`.
   *
   * Without it, concurrent requests for different locales share one global
   * locale and can render each other's language.
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

/** Options for {@link ssrFacet}, split between its two halves. */
export interface SsrFacetOptions extends SsrWrappingOptions, SsrRuntimeOptions {}

/**
 * Wraps the server entry so each render runs inside a request scope.
 *
 * Rewrites the entry's `render` export to call the original through
 * `runInRequestScope`, which is what gives {@link ssrRuntimeFacet} a locale to
 * scope. Half of {@link ssrFacet}.
 */
export function ssrWrappingFacet(options: SsrWrappingOptions = {}): ZintlFacet {
  return {
    name: "ssr-wrapping",
    when: { ssr: true },
    provides: ["ssr:wrapping"],
    concern: "ssr",
    priority: 100,
    wrapCode: genericSsrWrapCode,
    ...(options.entryTargets ? { entryTargets: options.entryTargets } : {}),
    ...(options.wrapExports ? { wrapExports: options.wrapExports } : {}),
    ...(options.wrapDefault ? { wrapDefault: options.wrapDefault } : {}),
  };
}

/**
 * The server-side runtime: per-request locale scoping and HTML injection.
 *
 * Turns on the `AsyncLocalStorage`-based store so concurrent requests cannot
 * bleed locales into each other, and the response/stream injector that sets
 * `<html lang>` and `dir` on the way out. This code is only included in builds
 * that install this facet — client bundles never see it.
 *
 * Half of {@link ssrFacet}.
 */
export function ssrRuntimeFacet(options: SsrRuntimeOptions = {}): ZintlFacet {
  return {
    name: "ssr-runtime",
    when: { ssr: true },
    concern: "runtime",
    priority: 100,
    serverRequestScope:
      options.serverRequestScope !== undefined ? options.serverRequestScope : true,
    streamInjection: options.streamInjection !== undefined ? options.streamInjection : true,
  };
}

/**
 * Full SSR support: {@link ssrWrappingFacet} plus {@link ssrRuntimeFacet}.
 *
 * Included in the built-in set for SSR builds, except on Next.js — {@link nextjsFacet}
 * brings its own, and installing both would collide on the same hook.
 */
export function ssrFacet(options: SsrFacetOptions = {}): ZintlFacet[] {
  return [ssrWrappingFacet(options), ssrRuntimeFacet(options)];
}
