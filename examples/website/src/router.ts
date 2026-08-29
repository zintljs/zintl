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
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("./pages/NotFoundPage.vue"),
  },
];

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
    if (to.hash) return { el: to.hash, behavior: "smooth", top: 96 };
    return { top: 0 };
  },
});
