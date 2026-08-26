import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Lab } from "../environment/lab.js";

/**
 * A translation catalog on disk that a contract can read, edit or destroy.
 *
 * `carriesKey` says whether this is the catalog holding the key the caller
 * asked about, or a stand-in — the same distinction {@link DeliveryProbe}
 * records, and for the same reason. A contract that corrupts *a* catalog
 * proves resilience wherever it lands; a contract that edits a translation and
 * asserts the page followed only proves anything on the catalog carrying that
 * string, and a reader of a green run deserves to know which they got.
 */
export type CatalogProbe =
  | { ok: true; path: string; keys: string[]; carriesKey: boolean }
  | { ok: false; why: string };

/**
 * Locate a catalog by asking the compiler, never by guessing a path.
 *
 * **What this replaces.** `chaos-catalog` carried its own `findCatalogPath`,
 * which tried `src/i18n/translations.json`, then a recursive walk of `zintl/`,
 * and threw otherwise. Both are real layouts — and neither is *the* layout.
 * `outputDir` is a user option (`packages/zintl/src/types.ts`, default
 * `"./zintl"`) and every Rsbuild example in this repo sets it to `src/locales`,
 * which that helper had never heard of. So `chaos` was unclaimable on eight
 * projects for a reason that had nothing to do with the host: the contract
 * could not find files that were sitting right there.
 *
 * That is the third time a **contract** limitation has been recorded in a
 * manifest as a **host** limitation (L-049, L-056). The rule that prevents a
 * fourth: when a question has one authoritative answer, ask the thing that
 * holds it. The compiler resolved `outputDir` and `catalogFormat`; it owns
 * `getCatalogPath`, which already handles grouped catalogs, `[locale]` tokens,
 * content boundaries and nested-function anchors. Reimplementing any of that in
 * a test is how the guesses started.
 *
 * Selection among the candidates is **by content** — the catalog carrying
 * `key` — matching the codebase's content-based identity rule, and falling back
 * to any catalog for the locale the way {@link pickDeliveryProbe} falls back to
 * any registered boundary.
 *
 * Dev-mode only, by construction: it needs the live compiler. That is not a
 * restriction in practice — every contract that touches a catalog file runs a
 * dev server — and a loud failure beats reintroducing a path guess for the case
 * that does not arise.
 */
export function findCatalogFor(lab: Lab, opts: { locale: string; key?: string }): CatalogProbe {
  const compiler = lab.compiler.instance;
  if (!compiler) {
    return {
      ok: false,
      why:
        `no live Zintl compiler for ${lab.root} — a catalog's location is a property of the ` +
        `compiler's resolved options (outputDir, catalogFormat), so there is nothing to ask`,
    };
  }

  let boundaryIds: string[];
  try {
    const graph = lab.compiler.getBoundaryGraph();
    boundaryIds = [...(graph?.nodes?.keys() ?? [])];
  } catch (err) {
    return { ok: false, why: `the boundary graph is not available: ${(err as Error).message}` };
  }

  // Sorted, so which catalog a fallback picks is a function of the project
  // rather than of boundary-graph insertion order.
  const paths = [
    ...new Set(
      boundaryIds
        .map((bId) => compiler.catalog.getCatalogPath(bId, opts.locale))
        .filter((p): p is string => typeof p === "string" && existsSync(p)),
    ),
  ].sort();

  if (paths.length === 0) {
    return {
      ok: false,
      why:
        `the compiler resolved outputDir to ${JSON.stringify(compiler.outputDir)} and none of the ` +
        `${boundaryIds.length} boundaries has a catalog on disk for locale ` +
        `${JSON.stringify(opts.locale)}`,
    };
  }

  const read = (path: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!parsed || typeof parsed !== "object") return [];
      // `$schema` is a JSON-Schema pointer the compiler writes, not a message.
      return Object.keys(parsed).filter((k) => !k.startsWith("$"));
    } catch {
      // A catalog this contract cannot parse is still a catalog it can target;
      // `chaos-catalog` deliberately writes one.
      return [];
    }
  };

  if (opts.key) {
    for (const path of paths) {
      const keys = read(path);
      if (keys.includes(opts.key)) {
        return { ok: true, path: relative(lab.root, path), keys, carriesKey: true };
      }
    }
  }

  return { ok: true, path: relative(lab.root, paths[0]), keys: read(paths[0]), carriesKey: false };
}

/**
 * Where the localized copy of a source asset lives, derived rather than declared.
 *
 * The compiler writes each localized asset under `outputDir`, mirroring the
 * source path with the locale inserted before the extension — `src/about.txt`
 * with `outputDir: "./src/locales"` becomes `src/locales/src/about.ar.txt`.
 * That is a compiler convention, not a property of any application, so a
 * manifest declares only the source asset (`AssetsAdapter.assetFile`) and this
 * works out the rest from the compiler's own resolved `outputDir`.
 *
 * Returned relative to the project root, ready for `lab.fs`.
 *
 * `outputDir` is normally read off the running compiler, and must be passed
 * explicitly when there is not one — a **project lab** builds without ever
 * starting a dev server, so `lab.compiler.instance` is undefined there. This
 * used to fall back to `"./zintl"` in that case, which is the default for
 * projects that never set the option and silently the wrong path for every
 * project that does: it produced a plausible filename, `lab.fs` read it, and
 * the contract failed on a missing file several steps away from the cause.
 */
export function localizedAssetPath(
  lab: Lab,
  assetFile: string,
  locale: string,
  outputDir?: string,
): string {
  const resolved = outputDir ?? lab.compiler.instance?.outputDir;
  if (!resolved) {
    throw new Error(
      `localizedAssetPath("${assetFile}", "${locale}") cannot tell where localized assets go: ` +
        `this lab has no running compiler to ask. Pass the project's \`outputDir\` explicitly — ` +
        `\`manifest.zintlOptions.outputDir\` is the one a contract already has in hand.`,
    );
  }
  const ext = extname(assetFile);
  const withLocale = `${assetFile.slice(0, assetFile.length - ext.length)}.${locale}${ext}`;
  return relative(lab.root, join(lab.root, resolved, withLocale));
}

/**
 * Rewrite one translation, in whichever of the two catalog shapes this project uses.
 *
 * `catalogFormat` decides the shape, and both are in the manifest today:
 *
 * - **Per-locale file** — the default `<path>.<locale>.json`. Values are plain
 *   strings: `{ "Count is {n}": "El recuento es {n}" }`.
 * - **Merged file** — a `catalogFormat` with no `[locale]` token, such as
 *   `rsbuild-vanilla-basic`'s `"translations.json"`. Every locale shares one
 *   file and values are objects: `{ "Count is {n}": { "es": "…", "ar": "…" } }`.
 *
 * A contract that assumed the first would silently replace an entire
 * per-locale object with a bare string on the second — writing a catalog that
 * still parses, still contains the key, and has quietly deleted three other
 * languages. Which shape a project uses is a compiler-configuration fact, so it
 * is detected here rather than declared in twenty manifests.
 */
export function setTranslation(
  content: string,
  key: string,
  locale: string,
  value: string,
): string {
  const catalog = JSON.parse(content) as Record<string, unknown>;
  if (!(key in catalog)) {
    throw new Error(
      `the catalog no longer carries ${JSON.stringify(key)}; it holds ` +
        `${Object.keys(catalog).filter((k) => !k.startsWith("$")).length} message(s)`,
    );
  }

  const existing = catalog[key];
  if (existing !== null && typeof existing === "object" && !Array.isArray(existing)) {
    catalog[key] = { ...(existing as Record<string, unknown>), [locale]: value };
  } else {
    catalog[key] = value;
  }

  return `${JSON.stringify(catalog, null, 2)}\n`;
}
