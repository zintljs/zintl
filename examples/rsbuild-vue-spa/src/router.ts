import { createRouter, createWebHistory } from "vue-router";
import HelloWorld from "./components/HelloWorld.vue";

const routes = [
  { path: "/", name: "Home", component: HelloWorld },
  {
    path: "/about",
    name: "About",
    // Lazy loaded, so Zintl's catalog for this boundary splits with the chunk
    component: () => import("./components/AboutWorld.vue"),
  },
];

export const router = createRouter({ history: createWebHistory(), routes });

// Preserve the current `lang` query parameter across route transitions
router.beforeEach((to, from, next) => {
  const lang = to.query.lang || from.query.lang;
  if (lang && to.query.lang !== lang) {
    next({ path: to.path, query: { ...to.query, lang } });
  } else {
    next();
  }
});
