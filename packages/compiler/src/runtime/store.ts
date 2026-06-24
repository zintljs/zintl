declare const process: any;

type Catalog = Record<string, string | Function>;
type BoundaryCatalogs = Record<string, Catalog>;
export type Catalogs = Record<string, BoundaryCatalogs>;
type LoaderResult = Catalog | BoundaryCatalogs | Promise<Catalog | BoundaryCatalogs>;
export type Loader = (locale: string) => LoaderResult;

let storeStorage: any = null;
if (typeof window === "undefined" && typeof process !== "undefined") {
  try {
    const asyncHooks = await import("node:async_hooks");
    if (asyncHooks && asyncHooks.AsyncLocalStorage) {
      if (typeof globalThis !== "undefined") {
        if (!(globalThis as any).__zintl_storage) {
          (globalThis as any).__zintl_storage = new asyncHooks.AsyncLocalStorage();
        }
        storeStorage = (globalThis as any).__zintl_storage;
      } else {
        storeStorage = new asyncHooks.AsyncLocalStorage();
      }
    }
  } catch {}
}

export class I18nStore {
  locale: string = "";
  catalogs: Catalogs = {};
  locales: string[] = [];
  debug: boolean = (typeof process !== "undefined" && process.env.ZINTL_DEBUG === "true") || false;
  pendingBoundaries = new Set<string>();
  pendingPromises: Promise<any>[] = [];
  version: number = 0;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof document !== "undefined" && document.documentElement) {
      this.locale = document.documentElement.lang || "";
    }
    if (!this.locale && typeof window !== "undefined") {
      try {
        this.locale = localStorage.getItem("zintl-locale") || "";
      } catch {}
    }
    if (!this.locale) {
      try {
        if (storeStorage) {
          const active = storeStorage.getStore();
          if (active && active !== this) {
            this.locale = active.locale;
          }
        }
      } catch {}
    }
    if (typeof window !== "undefined" && (window as any).__zintl_baked_catalogs) {
      this.addCatalogs((window as any).__zintl_baked_catalogs);
    }
  }

  getLocales(): string[] {
    if (
      this.locales.length === 0 &&
      typeof window !== "undefined" &&
      (window as any).__zintl_locales
    ) {
      this.locales = (window as any).__zintl_locales;
    }
    return this.locales;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((l) => l());
  }

  addCatalogs(newCatalogs: Catalogs) {
    let changed = false;
    for (const [locale, boundaries] of Object.entries(newCatalogs)) {
      if (!this.catalogs[locale]) {
        this.catalogs[locale] = {};
      }
      for (const [boundaryId, messages] of Object.entries(boundaries)) {
        if (!this.catalogs[locale][boundaryId]) {
          this.catalogs[locale][boundaryId] = {};
        }
        for (const [key, value] of Object.entries(messages as Catalog)) {
          if (this.catalogs[locale][boundaryId][key] !== value) {
            this.catalogs[locale][boundaryId][key] = value;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(
          "[Zintl] Catalogs updated:",
          Object.keys(newCatalogs).flatMap((l) =>
            Object.keys(newCatalogs[l]).map((b) => `${l}/${b}`),
          ),
        );
      }
      this.notify();
    }
  }

  async setLocale(locale: string | null | undefined) {
    if (!locale) return;

    if (typeof window !== "undefined") {
      if ((window as any).__zintlApplyHtml) {
        (window as any).__zintlApplyHtml(locale);
      }
      try {
        localStorage.setItem("zintl-locale", locale);
      } catch {}
    }

    if (this.locale === locale && Object.keys(this.catalogs[locale] || {}).length > 0) {
      return;
    }

    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
      console.debug(`[Zintl] Switching to locale: ${locale}`);
    }
    this.locale = locale;

    const activePromises: Promise<void>[] = [];

    for (const [boundaryId, loader] of globalRegistry.entries()) {
      try {
        const result = loader(locale);
        const processResult = (res: Catalog | BoundaryCatalogs) => {
          if (!res) return;
          this.addCatalogs({ [locale]: res } as Catalogs);
        };

        if (isThenable(result)) {
          this.pendingBoundaries.add(boundaryId);
          activePromises.push(
            (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
              processResult(res);
              this.pendingBoundaries.delete(boundaryId);
            }),
          );
        } else {
          processResult(result);
        }
      } catch (err) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          console.error(
            `[Zintl] Failed to load catalog for boundary "${boundaryId}" (${locale})`,
            err,
          );
        }
      }
    }

    if (activePromises.length > 0) {
      await Promise.all(activePromises);
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(`[Zintl] Locale "${locale}" hydrated.`);
      }
      this.notify();
    } else {
      this.version++;
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production" && this.debug) {
        console.debug(`[Zintl] Locale "${locale}" hydrated.`);
      }
      this.notify();
    }
  }

  registerLoader(boundaryId: string, loader: Loader) {
    globalRegistry.set(boundaryId, loader);
    const result = loader(this.locale);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      this.addCatalogs({ [this.locale]: res } as Catalogs);
    };

    if (isThenable(result)) {
      this.pendingBoundaries.add(boundaryId);
      return (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
        processResult(res);
        this.pendingBoundaries.delete(boundaryId);
      });
    } else {
      processResult(result);
    }
  }

  loadLazyBoundary(boundaryId: string, loader: Loader) {
    if (this.catalogs[this.locale]?.[boundaryId]) return;
    if (this.pendingBoundaries.has(boundaryId)) return;

    this.pendingBoundaries.add(boundaryId);

    try {
      const result = loader(this.locale);
      const processResult = (res: any) => {
        this.pendingBoundaries.delete(boundaryId);
        if (!res) return;
        this.addCatalogs({ [this.locale]: res } as Catalogs);
      };

      if (isThenable(result)) {
        const p = (result as Promise<any>)
          .then((res) => {
            processResult(res);
          })
          .catch(() => {
            this.pendingBoundaries.delete(boundaryId);
          });
        this.pendingPromises.push(p);
        return p;
      } else {
        processResult(result);
      }
    } catch {
      this.pendingBoundaries.delete(boundaryId);
    }
  }
}

let globalRegistry: Map<string, Loader>;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_registry) {
    (globalThis as any).__zintl_registry = new Map<string, Loader>();
  }
  globalRegistry = (globalThis as any).__zintl_registry;
} else {
  globalRegistry = new Map<string, Loader>();
}

let defaultInstance: I18nStore;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_default_instance) {
    (globalThis as any).__zintl_default_instance = new I18nStore();
  }
  defaultInstance = (globalThis as any).__zintl_default_instance;
} else {
  defaultInstance = new I18nStore();
}

let currentInstance = defaultInstance;
if (typeof globalThis !== "undefined") {
  if (!(globalThis as any).__zintl_current_instance) {
    (globalThis as any).__zintl_current_instance = defaultInstance;
  }
  currentInstance = (globalThis as any).__zintl_current_instance;
}

export function getActiveInstance() {
  if (storeStorage) {
    const store = storeStorage.getStore();
    if (store) return store;
  }
  if (
    typeof window === "undefined" &&
    typeof globalThis !== "undefined" &&
    (globalThis as any).__zintl_active
  ) {
    return (globalThis as any).__zintl_active;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).__zintl_current_instance) {
    return (globalThis as any).__zintl_current_instance;
  }
  if (typeof window !== "undefined") {
    const inst = currentInstance;
    const locales = inst.getLocales();
    const docLang =
      typeof document !== "undefined" && document.documentElement
        ? document.documentElement.lang
        : "";

    let targetLocale = "";
    const pathname = window.location ? window.location.pathname : "";
    if (pathname && locales.length > 0) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        targetLocale = parts[0];
      }
    }

    if (!targetLocale && docLang && locales.includes(docLang)) {
      targetLocale = docLang;
    }

    if (targetLocale && targetLocale !== inst.locale) {
      void inst.setLocale(targetLocale);
    }
  }
  return currentInstance;
}

export function setActiveInstance(instance: I18nStore) {
  currentInstance = instance;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__zintl_current_instance = instance;
  }
}

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

export function runInRequestScope<T>(
  urlOrReq: any,
  locales: string[],
  defaultLocale: string,
  callback: () => T,
): any {
  if (typeof window === "undefined" && storeStorage) {
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
      return storeStorage.run(store, () => {
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
  return callback();
}

export { storeStorage };

export function registerLoader(boundaryId: string, loader: Loader) {
  globalRegistry.set(boundaryId, loader);

  // Sync current active instance with this loader
  const instance = getActiveInstance();
  if (instance.catalogs[instance.locale]?.[boundaryId]) {
    return;
  }
  try {
    const result = loader(instance.locale);
    const processResult = (res: Catalog | BoundaryCatalogs) => {
      if (!res) return;
      instance.addCatalogs({ [instance.locale]: res } as Catalogs);
    };

    if (isThenable(result)) {
      const p = (result as Promise<Catalog | BoundaryCatalogs>).then((res) => {
        processResult(res);
      });
      if ((instance as any).pendingPromises) {
        (instance as any).pendingPromises.push(p);
      }
      return p;
    } else {
      processResult(result);
    }
  } catch (err) {
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      console.error(`[Zintl] Failed to load initial catalog for boundary "${boundaryId}"`, err);
    }
  }
}

export function unregisterLoader(boundaryId: string) {
  globalRegistry.delete(boundaryId);
}

export function setLocale(locale?: string | null) {
  return getActiveInstance().setLocale(locale);
}

export function getLocale() {
  return getActiveInstance().locale;
}

// export function getCatalogs() {
//   return getActiveInstance().catalogs;
// }

export function subscribe(listener: () => void) {
  return getActiveInstance().subscribe(listener);
}

export function addCatalogs(catalogs: Catalogs) {
  return getActiveInstance().addCatalogs(catalogs);
}

export function getStoreVersion() {
  return getActiveInstance().version;
}

function isThenable(obj: any): obj is Promise<any> {
  return obj && typeof obj.then === "function";
}

if (typeof window !== "undefined") {
  const syncLocale = () => {
    const inst = getActiveInstance();
    const locales = inst.getLocales();
    if (locales.length === 0) return;

    // 1. Try to sync from URL pathname
    const pathname = window.location.pathname;
    if (pathname) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length > 0 && locales.includes(parts[0])) {
        if (inst.locale !== parts[0]) {
          void inst.setLocale(parts[0]);
          return;
        }
      }
    }

    // 2. Try to sync from document element lang
    if (typeof document !== "undefined" && document.documentElement) {
      const docLang = document.documentElement.lang;
      if (docLang && locales.includes(docLang) && inst.locale !== docLang) {
        void inst.setLocale(docLang);
      }
    }
  };

  // Listen to popstate and history monkey-patch
  window.addEventListener("popstate", syncLocale);

  // oxlint-disable-next-line typescript/unbound-method
  const origPush = window.history.pushState;
  if (origPush) {
    window.history.pushState = function (...args) {
      origPush.apply(this, args);
      syncLocale();
    };
  }

  // oxlint-disable-next-line typescript/unbound-method
  const origReplace = window.history.replaceState;
  if (origReplace) {
    window.history.replaceState = function (...args) {
      origReplace.apply(this, args);
      syncLocale();
    };
  }

  // MutationObserver for documentElement.lang changes
  if (
    typeof MutationObserver !== "undefined" &&
    typeof document !== "undefined" &&
    document.documentElement
  ) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "lang") {
          syncLocale();
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  }

  // Initial sync
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncLocale);
  } else {
    syncLocale();
  }
}
