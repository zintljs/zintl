import type { ZintlAdapter, SsrWrapParams } from "../types.js";
import { registerPreset } from "../resolve.js";
import { reactExtractionAdapter, reactCodegenAdapter } from "./react.js";

// ── Next.js SSR Adapter ───────────────────────────────────────────────────────

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
    !fileId.endsWith("entry-server.js")
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

const nextjsSsrAdapter: ZintlAdapter = {
  name: "nextjs-ssr",
  extraction: {
    targets: ["jsx:*:aria-label", "jsx:*:aria-description"],
    extensions: [],
  },
  ssr: {
    entryTargets: [
      "virtual:vinext-rsc-entry",
      "virtual:vinext-server-entry",
      "virtual:vinext-app-ssr-entry",
      "app-ssr-entry",
    ],
    wrapCode: nextjsSsrWrapCode,
    wrapExports: ["renderPage", "handleApiRoute", "runMiddleware", "handleSsr"],
    wrapDefault: "fetch",
  },
  runtime: {
    serverRequestScope: true,
    streamInjection: true,
  },
};

registerPreset("nextjs", () => [reactExtractionAdapter, reactCodegenAdapter, nextjsSsrAdapter]);

export { nextjsSsrAdapter };
