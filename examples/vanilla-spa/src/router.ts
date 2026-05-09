type Route = {
  path: string;
  component: () => string | HTMLElement | Promise<string | HTMLElement>;
};

export class Router {
  private routes: Route[] = [];
  private rootElement: HTMLElement;

  constructor(rootElement: HTMLElement) {
    this.rootElement = rootElement;
    window.addEventListener("popstate", () => this.handleRoute());
  }

  addRoute(path: string, component: () => string | HTMLElement | Promise<string | HTMLElement>) {
    this.routes.push({ path, component });
  }

  async navigate(path: string) {
    const url = new URL(path, window.location.origin);
    const currentParams = new URLSearchParams(window.location.search);
    const lang = currentParams.get("lang");

    if (lang && !url.searchParams.has("lang")) {
      url.searchParams.set("lang", lang);
    }

    window.history.pushState({}, "", url.pathname + url.search + url.hash);
    await this.handleRoute();
  }

  private async handleRoute() {
    const path = window.location.pathname;
    const route = this.routes.find((r) => r.path === path) || this.routes[0];
    if (route) {
      const content = await route.component();
      if (typeof content === "string") {
        this.rootElement.innerHTML = content;
      } else {
        this.rootElement.innerHTML = "";
        this.rootElement.appendChild(content);
      }
    }
  }

  async init() {
    await this.handleRoute();
  }
}
