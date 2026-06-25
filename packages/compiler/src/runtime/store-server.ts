import { AsyncLocalStorage } from "node:async_hooks";
import {
  I18nStore,
  setStoreStorage,
  globalRegistry,
  isThenable,
  setRunInRequestScope,
} from "./store-core.js";
import type { Catalogs } from "./store-core.js";

const storage = new AsyncLocalStorage<I18nStore>();
setStoreStorage(storage);

function serializeValue(val: any): string {
  if (typeof val === "function") {
    return val.toString();
  }
  if (val === null) {
    return "null";
  }
  if (val === undefined) {
    return "undefined";
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return val.toString();
  }
  if (Array.isArray(val)) {
    return "[" + val.map(serializeValue).join(",") + "]";
  }
  if (typeof val === "object") {
    return (
      "{" +
      Object.entries(val)
        .map(([k, v]) => `${JSON.stringify(k)}:${serializeValue(v)}`)
        .join(",") +
      "}"
    );
  }
  return "null";
}

function injectIntoStream(stream: ReadableStream, store: I18nStore): ReadableStream {
  const reader = stream.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let injected = false;

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (!injected) {
            const catalogs = store.catalogs;
            if (Object.keys(catalogs).length > 0) {
              const script = `<script id="zintl-baked-catalogs">window.__zintl_baked_catalogs = ${serializeValue(catalogs)};window.__zintl_locales = ${JSON.stringify(store.locales)};</script>`;
              controller.enqueue(encoder.encode(script));
            }
            injected = true;
          }
          controller.close();
          return;
        }

        let chunkText = "";
        if (value instanceof Uint8Array) {
          chunkText = decoder.decode(value, { stream: true });
        } else if (typeof value === "string") {
          chunkText = value;
        }

        if (!injected) {
          if (chunkText.includes("</body>")) {
            const catalogs = store.catalogs;
            const script =
              Object.keys(catalogs).length > 0
                ? `<script id="zintl-baked-catalogs">window.__zintl_baked_catalogs = ${serializeValue(catalogs)};window.__zintl_locales = ${JSON.stringify(store.locales)};</script>`
                : "";
            chunkText = chunkText.replace("</body>", `${script}</body>`);
            injected = true;
            controller.enqueue(encoder.encode(chunkText));
          } else if (chunkText.includes("</html>")) {
            const catalogs = store.catalogs;
            const script =
              Object.keys(catalogs).length > 0
                ? `<script id="zintl-baked-catalogs">window.__zintl_baked_catalogs = ${serializeValue(catalogs)};window.__zintl_locales = ${JSON.stringify(store.locales)};</script>`
                : "";
            chunkText = chunkText.replace("</html>", `${script}</html>`);
            injected = true;
            controller.enqueue(encoder.encode(chunkText));
          } else {
            controller.enqueue(value instanceof Uint8Array ? value : encoder.encode(chunkText));
          }
        } else {
          controller.enqueue(value instanceof Uint8Array ? value : encoder.encode(chunkText));
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function injectBakedCatalogs(result: any, store: I18nStore): any {
  if (!result || !store) return result;
  if (typeof Response !== "undefined" && result instanceof Response) {
    if (result.body && typeof result.body.getReader === "function") {
      const transformedBody = injectIntoStream(result.body, store);
      return new Response(transformedBody, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    }
    return result.text().then((html) => {
      if (html.includes("</body>") || html.includes("</html>")) {
        const modifiedHtml = injectBakedCatalogs(html, store);
        return new Response(modifiedHtml, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        });
      }
      return new Response(html, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    });
  }
  if (typeof result === "string") {
    const catalogs = store.catalogs;
    if (Object.keys(catalogs).length > 0) {
      const script = `<script id="zintl-baked-catalogs">window.__zintl_baked_catalogs = ${serializeValue(catalogs)};window.__zintl_locales = ${JSON.stringify(store.locales)};</script>`;
      if (result.includes("</body>")) {
        return result.replace("</body>", `${script}</body>`);
      }
      if (result.includes("</html>")) {
        return result.replace("</html>", `${script}</html>`);
      }
      const lower = result.toLowerCase();
      if (lower.includes("<!doctype") || lower.includes("<html") || lower.includes("<body")) {
        return result + script;
      }
      return result;
    }
  }
  if (typeof result === "object") {
    if (typeof result.getReader === "function") {
      return injectIntoStream(result, store);
    } else if (result.htmlStream && typeof result.htmlStream.getReader === "function") {
      result.htmlStream = injectIntoStream(result.htmlStream, store);
    } else if (result.body && typeof result.body.getReader === "function") {
      result.body = injectIntoStream(result.body, store);
    } else if (typeof result.html === "string") {
      result.html = injectBakedCatalogs(result.html, store);
    } else if (typeof result.body === "string") {
      result.body = injectBakedCatalogs(result.body, store);
    }
  }
  return result;
}

function runInRequestScope<T>(
  urlOrReq: any,
  locales: string[],
  defaultLocale: string,
  callback: () => T,
): any {
  let locale = defaultLocale;
  if (urlOrReq) {
    let pathname = "";
    const extractPath = (val: any): string => {
      if (!val) return "";
      if (typeof val === "string") return val;
      if (typeof val === "object") {
        if (val.url) {
          return typeof val.url === "string" ? val.url : val.url.pathname || String(val.url);
        }
        if (typeof val.path === "string") return val.path;
        if (typeof val.pathname === "string") return val.pathname;
        if (val.navigationContext) {
          const nav = val.navigationContext;
          if (typeof nav.pathname === "string") return nav.pathname;
        }
      }
      return "";
    };

    if (Array.isArray(urlOrReq)) {
      for (const arg of urlOrReq) {
        pathname = extractPath(arg);
        if (pathname) break;
      }
    } else {
      pathname = extractPath(urlOrReq);
    }

    if (pathname) {
      pathname = pathname.split("?")[0].split("#")[0];
      if (pathname.includes("://")) {
        try {
          pathname = new URL(pathname).pathname;
        } catch {
          pathname = pathname.replace(/^https?:\/\/[^/]+/, "");
        }
      } else {
        pathname = pathname.replace(/^[^/]+:\d+/, "");
        pathname = pathname.replace(/^[^/]+\.[^/]+/, "");
      }

      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        locale = parts[0];
      }
    }
  }

  const store = new I18nStore();
  store.locale = locale;
  store.locales = locales;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__zintl_active = store;
  }

  const promises: Promise<any>[] = [];
  for (const [_, loader] of globalRegistry.entries()) {
    try {
      const result = loader(locale);
      const processResult = (res: any) => {
        if (!res) {
          return;
        }
        store.addCatalogs({ [locale]: res } as Catalogs);
      };
      if (isThenable(result)) {
        promises.push(
          (result as Promise<any>).then((res) => {
            processResult(res);
          }),
        );
      } else {
        processResult(result);
      }
    } catch {}
  }

  const runCallback = () => {
    return storage.run(store, () => {
      const result = callback();

      const processStorePromisesAndInject = (resolvedResult: any): any => {
        if (store.pendingPromises.length > 0) {
          const currentPromises = [...store.pendingPromises];
          store.pendingPromises = [];
          return Promise.all(currentPromises).then(() => {
            return processStorePromisesAndInject(resolvedResult);
          });
        }
        return injectBakedCatalogs(resolvedResult, store);
      };

      if (result && typeof (result as any).then === "function") {
        return (result as any).then((resolvedResult: any) => {
          return processStorePromisesAndInject(resolvedResult);
        });
      }

      if (store.pendingPromises.length > 0) {
        return processStorePromisesAndInject(result);
      }

      return injectBakedCatalogs(result, store) as any;
    });
  };

  if (promises.length > 0) {
    return Promise.all(promises).then(runCallback);
  }
  return runCallback();
}

setRunInRequestScope(runInRequestScope);
