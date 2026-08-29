import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { DEFAULT_LOCALE } from "./locale";
import LandingPage from "./pages/LandingPage.vue";

/**
 * `en|ar|es|zh` is spelled into the path pattern rather than derived from
 * `LOCALES`, because vue-router wants a literal regex fragment and a generated
 * one would be a string the type system stops checking. Four locales is a size
 * where the duplication is cheaper than the indirection; if it grows, generate
 * it and keep this comment as the reason it used to be written out.
 */
const LOCALE_SEGMENT = ":locale(en|ar|es|zh)";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: `/${DEFAULT_LOCALE}` },
  {
    path: `/${LOCALE_SEGMENT}`,
    name: "home",
    component: LandingPage,
  },
  {
    // Lazy, and that is the demonstration rather than an optimization: one
    // chunk per docs page means one *catalog* per docs page, arriving when the
    // reader navigates and in the language they are reading.
    path: `/${LOCALE_SEGMENT}/:section(guide|concepts|reference)/:slug`,
    name: "doc",
    component: () => import("./pages/DocsPage.vue"),
  },
  {
    /**
     * A docs path with no locale, sent to the default one.
     *
     * Links written inside translatable prose cannot carry a locale: they are
     * plain `<a href>` in a stitched sentence, so there is no binding to put
     * one in. The click handler in `App.vue` supplies it while the app is
     * running; this covers the rest — a link opened in a new tab, a URL typed
     * by hand, a crawler.
     */
    path: "/:section(guide|concepts|reference)/:slug",
    redirect: (to) => `/${DEFAULT_LOCALE}/${to.params.section}/${to.params.slug}`,
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("./pages/NotFoundPage.vue"),
  },
];

/**
 * Scroll to a heading that does not exist yet.
 *
 * Two things stop the obvious `{ el: to.hash }` from working. A docs page
 * awaits its body, so at the moment `scrollBehavior` runs the heading is not in
 * the document — the selector matches nothing and the browser stays where it
 * was. And a hash from a non-English page is percent-encoded (`#cat%C3%A1logo`),
 * which is not a valid selector at all; it has to be decoded before it can be
 * looked up.
 *
 * Polling a handful of frames rather than watching for a mount: the wait is
 * bounded, the failure mode is "scroll to the top of the page you asked for",
 * and neither of those is worth a MutationObserver.
 */
async function waitForHeading(hash: string) {
  const id = decodeURIComponent(hash.slice(1));

  for (let attempt = 0; attempt < 20; attempt++) {
    const el = document.getElementById(id);
    if (el) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      return { el, top: 96, behavior: still ? ("auto" as const) : ("smooth" as const) };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return { top: 0 };
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    // A locale switch is the same page in another language. Jumping to the top
    // would lose the reader's place mid-paragraph, so only a real navigation
    // scrolls.
    if (to.path !== from.path && to.name === from.name && to.params.slug === from.params.slug) {
      return false;
    }
    if (to.hash) return waitForHeading(to.hash);
    return { top: 0 };
  },
});
