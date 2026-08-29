import { createApp } from "vue";
import { zintl } from "zintljs/macro";
import { localeFromPath } from "./locale";
import { router } from "./router";
import App from "./App.vue";
import "./styles/index.css";

/**
 * The trust anchor, at the top level of the entry — which is what makes this
 * file an entry point rather than a file that happens to call `zintl`.
 *
 * The argument is a **variable**, deliberately. `zintl("en")` here would be a
 * build-time fact: the compiler would bake English in, emit no catalog chunks,
 * and never build the other three locales — and the locale bar would render,
 * click, and do nothing. That failure is quiet rather than loud, which is why
 * it is worth a comment instead of a discovery.
 */
await zintl(localeFromPath(window.location.pathname));

createApp(App).use(router).mount("#app");
