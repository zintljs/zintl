import type { ZintlFacet, SsrWrapParams } from "../types.js";

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
  entryTargets?: string[];
  wrapExports?: string[];
  wrapDefault?: "fetch" | boolean;
}

export interface SsrRuntimeOptions {
  serverRequestScope?: boolean;
  streamInjection?: boolean;
}

export interface SsrFacetOptions extends SsrWrappingOptions, SsrRuntimeOptions {}

/**
 * SSR wrapping contribution.
 */
export function ssrWrappingFacet(options: SsrWrappingOptions = {}): ZintlFacet {
  return {
    name: "ssr-wrapping",
    concern: "ssr",
    priority: 100,
    wrapCode: genericSsrWrapCode,
    ...(options.entryTargets ? { entryTargets: options.entryTargets } : {}),
    ...(options.wrapExports ? { wrapExports: options.wrapExports } : {}),
    ...(options.wrapDefault ? { wrapDefault: options.wrapDefault } : {}),
  };
}

/**
 * SSR runtime capability contribution.
 */
export function ssrRuntimeFacet(options: SsrRuntimeOptions = {}): ZintlFacet {
  return {
    name: "ssr-runtime",
    concern: "runtime",
    priority: 100,
    serverRequestScope:
      options.serverRequestScope !== undefined ? options.serverRequestScope : true,
    streamInjection: options.streamInjection !== undefined ? options.streamInjection : true,
  };
}

export function ssrFacet(options: SsrFacetOptions = {}): ZintlFacet[] {
  return [ssrWrappingFacet(options), ssrRuntimeFacet(options)];
}
