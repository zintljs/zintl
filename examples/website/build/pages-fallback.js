import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * GitHub Pages has no SPA rewrite, so give it one.
 *
 * Pages serves static files and nothing else: a request for
 * `/zintl/ar/guide/what-is-zintl` matches no file and returns the 404 document.
 * Since that document can be anything, making it a copy of `index.html` means
 * the app boots and its router resolves the path — the same result a rewrite
 * rule would give, using the only hook Pages offers.
 *
 * The status code really is 404, which is wrong for a page that exists and is
 * the price of this host. It matters for crawlers rather than readers, and the
 * alternative — hash routing — puts a `#` in every URL the documentation
 * prints. A per-locale static build (`multiplex`) would remove the need
 * entirely, and is the better answer if this site ever outgrows the trade.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const index = join(dist, "index.html");

if (!existsSync(index)) {
  console.error("[pages-fallback] no dist/index.html — did the build run?");
  process.exit(1);
}

copyFileSync(index, join(dist, "404.html"));
console.log("[pages-fallback] wrote dist/404.html");
