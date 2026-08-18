import { executeProjectContract, type Contract } from "@zintljs/testing";
import { allManifests } from "../manifests/index.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A lazily loaded catalog stays small in the bundle a user actually downloads.
 *
 * **This contract measured something else for its whole life**, and its own
 * header said so. It captured HTTP response bodies inside a timing window on the
 * **dev server** and asserted each under 10 KB — a budget its comment conceded
 * was "adjusted to 10KB to support Vite dev-mode wrapper overhead". A dev module
 * bears no fixed relationship to shipped bytes, so the number it defended was
 * not the number in its name.
 *
 * Three separate ways it could not answer the question:
 *
 * 1. **The wrong artifact.** Dev-wrapped modules, not build output.
 * 2. **A timing window.** Which responses landed inside it varied per run —
 *    observed failing 1 run in 7 at 10,972 bytes while passing 3/3 in
 *    isolation. A size is a property of a file; nothing about it should depend
 *    on when you look.
 * 3. **A URL filter that could not see.** Four Vite-shaped fragments, one of
 *    them any `.json`, so an unrelated response could be measured as a catalog
 *    — and on Rspack, whose builds emit catalogs as ordinary hashed async
 *    chunks, it matched nothing at all and failed its own `toBeGreaterThan(0)`.
 *    That was recorded in eight manifests as a host missing a performance
 *    budget (ledger L-062).
 *
 * So it builds, and reads the emitted files. No page, no window, no URL.
 *
 * **Rspack claims it now** (L-078). The filter that kept the second host out is
 * gone and nothing here is host-shaped, so four Rsbuild projects were added
 * once `performance-hmr` stopped reporting the weather — that ordering was
 * deliberate, since `performance` gates both.
 *
 * **Chunks are found by content, which is the only host-neutral way to ask.**
 * Rollup emits `assets/entry_b_<hash>.js` and Rspack emits
 * `static/js/async/<hash>.js`; a path pattern that recognises both is a pattern
 * that recognises almost anything. A catalog chunk is instead the file carrying
 * a translation the compiler says is on disk for that locale — content-based
 * identity, the same rule boundary ids follow, and the reason a catalog can move
 * between hosts and still be recognised.
 */

/** The compiler's resolved `outputDir`, asked of the compiler rather than assumed. */
function instanceOutputDir(lab: { compiler: { instance?: unknown } }): string {
  const resolved = (lab.compiler.instance as { outputDir?: string } | undefined)?.outputDir;
  if (!resolved) {
    throw new Error(
      `No live Zintl compiler for this project, so its output directory — a resolved option, not ` +
        `a fixed path — cannot be asked for.`,
    );
  }
  return resolved;
}

export const performanceSizeContract: Contract<any> = {
  name: "Performance Size",
  description: "Verifies built lazy catalog chunks stay within a payload size budget",
  /**
   * `build` rather than `spa` + `locale-switch`: nothing here drives a page, and
   * what it needs is an emitted bundle and more than one locale in it.
   */
  requires: ["performance", "build"],
  async execute(lab) {
    const results = await lab.pipeline.build();

    const sourceLocale = (lab.compiler.instance as { sourceLocale?: string } | undefined)
      ?.sourceLocale;
    const locales = (
      (lab.compiler.instance as { locales?: string[] } | undefined)?.locales ?? []
    ).filter((l) => l !== sourceLocale);
    if (locales.length === 0) {
      throw new Error(
        `The compiler reports no locale other than the source one, so no catalog chunk is ever ` +
          `emitted and there is nothing to weigh.`,
      );
    }

    /**
     * Needles from **every** catalog this project ships, in every locale.
     *
     * Two earlier shapes of this were not enough, and each failed differently.
     * `findCatalogFor` returns one path, sorted, and the first alphabetically is
     * `index.html.<locale>.json` — a title and a text direction, no prose — so
     * the contract declared the project untestable with its real catalogs
     * sitting beside it. Enumerating the boundary graph instead resolved a
     * single catalog on three of four projects, because the graph a *build*
     * leaves behind is not the one the dev compiler holds.
     *
     * The output directory is the durable answer, and it is still the
     * compiler's own: `outputDir` is a resolved option, not a path this file
     * invented (L-062).
     *
     * Every non-source locale, not one: a per-locale catalog names its language
     * in its filename and a merged one keys by it, so walking the directory
     * yields all of them for free — and weighing *every* emitted catalog chunk
     * is the stronger claim. Restricting to one locale would leave the other
     * chunks unmeasured while reading exactly the same files.
     */
    const outputDir = join(lab.root, instanceOutputDir(lab));
    const needles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== ".schemas") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".json") || entry.name.endsWith(".schema.json")) continue;
        let catalog: Record<string, unknown>;
        try {
          catalog = JSON.parse(readFileSync(full, "utf-8")) as Record<string, unknown>;
        } catch {
          continue;
        }
        for (const [key, value] of Object.entries(catalog)) {
          if (key.startsWith("$")) continue;
          const texts: unknown[] =
            typeof value === "string"
              ? [value]
              : value && typeof value === "object" && !Array.isArray(value)
                ? locales.map((l) => (value as Record<string, unknown>)[l])
                : [];
          /**
           * The needle has to be a **translation**, not a value that happens to
           * equal its key.
           *
           * Catalogs legitimately carry passthrough entries — brand names,
           * anything a translator left as-is — and those strings are in the main
           * bundle too, because that is where the source text lives. Matching
           * one identified `index.js` as a catalog chunk on all four projects,
           * and reported a 538 KB application bundle as an oversized catalog. A
           * value that differs from its key can only have come from a catalog.
           */
          for (const text of texts) {
            if (
              typeof text === "string" &&
              text.trim() !== "" &&
              text !== key &&
              text.length >= 8 &&
              !text.includes("{")
            ) {
              needles.push(text);
            }
          }
        }
      }
    };
    if (existsSync(outputDir)) walk(outputDir);

    if (needles.length === 0) {
      throw new Error(
        `No catalog under ${outputDir} holds a plain translated string, so no emitted chunk ` +
          `can be identified by its content. Every value is empty, ICU, or identical to its key.`,
      );
    }

    const chunks = Object.entries(results).filter(
      ([path, code]) => path.endsWith(".js") && needles.some((needle) => code.includes(needle)),
    );

    if (chunks.length === 0) {
      throw new Error(
        `No emitted file carries any translation this project has on disk, so this build ships ` +
          `no catalogs at all — which is a delivery failure, not a size one.\n\n` +
          `Looked for ${needles.length} translated string(s) across ` +
          `${Object.keys(results).length} emitted file(s).`,
      );
    }

    /**
     * 8 KB, against catalogs that measure well under 1 KB today.
     *
     * The budget guards a **shape**, not a target: a catalog chunk carries one
     * boundary's strings for one locale, so it grows with the text an author
     * wrote and not with the application. Anything approaching this size means
     * something else has been pulled into the chunk — a runtime, a framework
     * import, the whole catalog set — which is the regression worth catching.
     * Sizes are reported on failure so the number can be judged rather than
     * guessed at.
     */
    const BUDGET = 8 * 1024;
    const oversize = chunks.filter(([, code]) => Buffer.byteLength(code, "utf8") > BUDGET);
    if (oversize.length > 0) {
      const report = chunks
        .map(([path, code]) => `  ${path}: ${Buffer.byteLength(code, "utf8")} bytes`)
        .join("\n");
      throw new Error(
        `${oversize.length} of ${chunks.length} catalog chunk(s) exceed the ${BUDGET}-byte ` +
          `budget:\n${report}\n\n` +
          `A catalog chunk holds one boundary's strings for one locale. At this size it is ` +
          `carrying something else.`,
      );
    }
  },
};

executeProjectContract(performanceSizeContract, allManifests);
