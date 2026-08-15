type Route = {
  path: string;
  component: () => HTMLElement | Promise<HTMLElement>;
};

/**
 * The smallest router that can ask the interesting question.
 *
 * A route whose component arrives through `await import()` is a lazy boundary,
 * and a lazy boundary is what makes Zintl's catalog split follow the bundler's
 * own chunking rather than sit in the entry. On Rspack that is `async/` chunks;
 * on Vite it is Rollup's. Neither Zintl nor this file knows which.
 */
export class Router {
  private routes: Route[] = [];
  private rootElement: HTMLElement;

  constructor(rootElement: HTMLElement) {
    this.rootElement = rootElement;
    window.addEventListener("popstate", () => void this.handleRoute());
  }

  addRoute(path: string, component: () => HTMLElement | Promise<HTMLElement>) {
    this.routes.push({ path, component });
  }

  /** Navigate, carrying `?lang` across so the locale survives a route change. */
  async navigate(path: string) {
    const url = new URL(path, window.location.origin);
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang && !url.searchParams.has("lang")) url.searchParams.set("lang", lang);

    window.history.pushState({}, "", url.pathname + url.search + url.hash);
    await this.handleRoute();
  }

  private async handleRoute() {
    const path = window.location.pathname;
    const route = this.routes.find((r) => r.path === path) ?? this.routes[0];
    if (!route) return;
    this.rootElement.replaceChildren(await route.component());
  }

  async init() {
    await this.handleRoute();
  }
}
