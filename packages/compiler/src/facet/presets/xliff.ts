/**
 * XLIFF 2.0 export — the first target of the TMS seam.
 *
 * ## Why a format rather than a vendor
 *
 * Proposal 032 §5: the compiler contributes material, a facet contributes
 * serialization and transport, and nothing in core learns what Crowdin is. The
 * first target being a *format* rather than a vendor is what makes the second
 * one someone else's job — every TMS ingests XLIFF, so this is the widest
 * possible landing without naming anyone.
 *
 * ## Why not JSON
 *
 * Catalogs stay JSON and stay the thing a human edits (§6). JSON has nowhere to
 * put the context, and the context is the whole value: a catalog handed to a
 * translator with no repo cannot say whether *Open* is a verb or an adjective,
 * which screens it appears on, or what `{input}` will be. `<unit>` with
 * `<notes>` can. **The repo never gains an XML file unless this facet is
 * configured.**
 *
 * ## What a translator actually sees
 *
 * Notes rather than `<mda:metadata>`, and that is the deciding property rather
 * than a preference: every TMS renders notes to the person doing the work,
 * while the metadata module is usually invisible in a translator UI. A derived
 * fact nobody sees is a fact that did not travel.
 */

import type {
  CompilerContext,
  ExchangeFacet,
  ExportBundle,
  ExportUnit,
  ImportedTranslation,
} from "../../types/capabilities.js";
import { isAbsolute, join } from "node:path";

export interface XliffFacetConfig {
  /**
   * Where the `.xlf` files go, relative to the project root.
   *
   * Outside `outputDir` by default, because these are not catalogs: they are
   * outbound copies with a different lifetime, and mixing them into the
   * directory the compiler prunes would put a translator's in-flight file under
   * a reclamation pass that knows nothing about it.
   *
   * @default "./l10n"
   */
  outDir?: string;
}

/** XML text content. Source strings are arbitrary user prose. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The human-facing notes for one unit — 032 §3, made visible.
 *
 * Every entry is derived from the boundary graph rather than typed by anyone,
 * which is the property that matters: a hand-written context field is stale the
 * day after it is written, and this cannot be. Order is fixed so a re-export
 * with nothing changed produces an identical file.
 */
function notesFor(unit: ExportUnit): { category: string; text: string }[] {
  const notes: { category: string; text: string }[] = [];
  const occurrences = unit.contexts.flatMap((c) => c.occurrences);

  // Authored by a developer, for a translator — the only note here a human wrote.
  const authored = occurrences.find((o) => o.note)?.note;
  if (authored) notes.push({ category: "zintl:note", text: authored });

  const where = occurrences.map((o) => o.context).filter((c): c is string => !!c);
  if (where.length > 0) {
    notes.push({
      category: "zintl:element",
      text: `Appears as: ${Array.from(new Set(where)).sort().join(", ")}`,
    });
  }

  const screens = new Set(unit.contexts.flatMap((c) => c.screens));
  if (screens.size > 0) {
    notes.push({
      category: "zintl:screens",
      text: `Appears on: ${Array.from(screens).sort().join(", ")}`,
    });
  }

  /**
   * The fact translators are never told, and the one that changes their
   * decision: this string is one string in several places, so a wording that
   * suits one of them has to suit all of them. Stated as a count of *places*
   * rather than a list of boundary ids, which are paths a translator has no use
   * for — the screens note above is the version they can act on.
   */
  if (unit.boundaryIds.length > 1) {
    notes.push({
      category: "zintl:shared",
      text:
        `Used in ${unit.boundaryIds.length} places — one translation covers all of ` +
        `them, so it has to read correctly in each.`,
    });
  }

  // `{input}` alone is unanswerable; `user.firstName` is not.
  const vars = new Map<string, string>();
  for (const o of occurrences) {
    for (const v of o.variables ?? []) if (!vars.has(v.name)) vars.set(v.name, v.expression);
  }
  for (const [name, expression] of Array.from(vars).sort((a, b) => a[0].localeCompare(b[0]))) {
    notes.push({ category: "zintl:placeholder", text: `{${name}} is ${expression}` });
  }

  /**
   * The carry-forward, stated rather than left for the TMS to guess (§1).
   *
   * Zintl reconciled first and this is the answer; a second translation memory
   * matching independently is a wrong-rename generator. `substitutesWords` is
   * called out separately because it is the dangerous kind of near-match —
   * "Enable notifications" and "Disable notifications" are ~0.86 similar and no
   * threshold will ever tell them apart.
   */
  if (unit.carriedForward) {
    const { from, score, substitutesWords } = unit.carriedForward;
    notes.push({
      category: "zintl:carried-forward",
      text:
        `Suggested from the earlier source text "${from}" ` +
        `(${Math.round(score * 100)}% similar). Please confirm it still reads correctly.` +
        (substitutesWords ? " A whole word changed — check the meaning did not invert." : ""),
    });
  }

  return notes;
}

/**
 * One `<unit>`.
 *
 * The `id` is the content-derived message id, so it survives a file move or a
 * function rename — which is the property a TMS cannot compute for itself and
 * the reason this direction of authority is forced (§0).
 */
function renderUnit(unit: ExportUnit): string {
  const notes = notesFor(unit);
  const lines: string[] = [`    <unit id="${esc(unit.id)}">`];

  if (notes.length > 0) {
    lines.push(`      <notes>`);
    for (const n of notes) {
      lines.push(`        <note category="${esc(n.category)}">${esc(n.text)}</note>`);
    }
    lines.push(`      </notes>`);
  }

  /**
   * `state` is the catalog's answer, not a guess: `translated` exactly when the
   * hive has a value, which is the same question `verifyIntegrity` asks. A
   * carry-forward is `translated` with a `subState` rather than `initial`,
   * because there *is* text in it — flagging it as untouched would throw away
   * the reconciliation this export exists to state.
   */
  const state = unit.target ? "translated" : "initial";
  const subState = unit.carriedForward ? ` subState="zintl:carried-forward"` : "";

  lines.push(`      <segment state="${state}"${subState}>`);
  lines.push(`        <source>${esc(unit.key)}</source>`);
  lines.push(`        <target>${esc(unit.target)}</target>`);
  lines.push(`      </segment>`);
  lines.push(`    </unit>`);
  return lines.join("\n");
}

function renderBundle(bundle: ExportBundle): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" ` +
      `srcLang="${esc(bundle.sourceLocale)}" trgLang="${esc(bundle.locale)}">`,
    /**
     * One `<file>`, because there is nothing for a second one to mean.
     *
     * Grouping by boundary is the obvious first shape and it is wrong: a string
     * reached from two boundaries would appear under both, and a translator
     * would be asked for the same words twice with nothing saying the answers
     * must match — while the hive, keyed by source text globally, would keep
     * whichever arrived last. One string, one unit (032 §8.1); where it appears
     * is a note.
     */
    `  <file id="zintl">`,
  ];

  for (const unit of bundle.units) lines.push(renderUnit(unit));

  lines.push(`  </file>`, `</xliff>`, ``);
  return lines.join("\n");
}

// ─── Reading it back ─────────────────────────────────────────────────────────

/**
 * XLIFF states that mean a human has signed the translation off.
 *
 * 032 §8.2 decided that only an **approved** translation is imported, and these
 * are XLIFF's two words for it: `reviewed` is "has been reviewed" and `final`
 * is "is finalized". `translated` is deliberately absent — that is the draft a
 * reviewer has not seen yet, and letting it through would make a passing
 * `verifyIntegrity` stop meaning "this locale is done", which is the whole
 * value of having the gate.
 */
const APPROVED_STATES = new Set(["reviewed", "final"]);

/** The five predefined XML entities, plus numeric escapes. */
function unesc(text: string): string {
  return (
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      // Last, so an escaped `&amp;lt;` survives as the literal text `&lt;`.
      .replace(/&amp;/g, "&")
  );
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/**
 * A reader for the shape this facet writes, which knows what it cannot read.
 *
 * Deliberately not a general XML parser. `@zintljs/compiler` has three
 * dependencies and every one of them is installed by everybody, including the
 * people who will never enable this facet — a parser in front of all of them to
 * serve an opt-in feature is the wrong trade.
 *
 * What makes that safe is that the limits are **reported rather than guessed
 * at**. Zintl escapes markup into text when it writes, so a `<` surviving
 * inside a `<source>` or `<target>` means the other system used XLIFF's inline
 * elements (`<pc>`, `<ph>`, `<mrk>`) — a shape this cannot reconstruct. It says
 * so, the gate refuses the unit, and nobody gets a silently mangled string.
 * That is the same instinct as the rest of §4: a gate that says "I could not
 * read this" is doing its job.
 */
function readUnits(xml: string): ImportedTranslation[] {
  const locale = attr(xml, "trgLang");
  if (!locale) return [];

  const out: ImportedTranslation[] = [];
  for (const [, body] of xml.matchAll(/<unit\b[^>]*>([\s\S]*?)<\/unit>/g)) {
    const segments = Array.from(body.matchAll(/<segment\b([^>]*)>([\s\S]*?)<\/segment>/g));
    if (segments.length === 0) continue;

    const rawSource = /<source\b[^>]*>([\s\S]*?)<\/source>/.exec(segments[0][2])?.[1] ?? "";
    const rawTarget = /<target\b[^>]*>([\s\S]*?)<\/target>/.exec(segments[0][2])?.[1] ?? "";
    const key = unesc(rawSource);
    const value = unesc(rawTarget);

    /**
     * Approval is read from the *first* segment even when a unit was split.
     * Knowing whether to skip it never needs the content, and a draft should be
     * skipped quietly rather than reported as unreadable.
     */
    const approved = APPROVED_STATES.has(attr(segments[0][1], "state") ?? "");

    let unreadable: string | undefined;
    if (segments.length > 1) {
      unreadable =
        `the translation system split this into ${segments.length} segments — ` +
        `Zintl treats a stitched sentence as one unit and cannot reassemble the pieces`;
    } else if (/</.test(rawSource) || /</.test(rawTarget)) {
      unreadable =
        `the segment uses XLIFF inline elements, which this importer does not read — ` +
        `configure the translation system to send plain text, or file this as a shape to support`;
    }

    out.push({ locale, key, value, approved, unreadable });
  }
  return out;
}

/**
 * Export every locale as XLIFF 2.0.
 *
 * ```ts
 * zintl({ facets: ["builtins", xliffFacet({ outDir: "./l10n" })] });
 * ```
 *
 * Writes on a production build only. Import is not implemented here — that is
 * 032 §7 step 4, and it lands with the validation gate in front of it rather
 * than behind it, deliberately.
 */
export function xliffFacet(config: XliffFacetConfig = {}): ExchangeFacet {
  const outDir = config.outDir ?? "./l10n";

  return {
    name: "xliff-exchange",
    concern: "exchange",
    async export(bundle: ExportBundle, context: CompilerContext) {
      const base = isAbsolute(outDir) ? outDir : join(context.root, outDir);
      const path = join(base, `${bundle.locale}.xlf`);

      /**
       * `safeWriteFile` rather than a bare write: it creates the directory,
       * skips a byte-identical rewrite, and books the write into the delivery
       * ledger like every other artifact the compiler produces. Its formatter
       * pass is dev-only and this runs on builds, so nothing reformats the XML.
       */
      await context.io.safeWriteFile(path, renderBundle(bundle), "xliff export");

      context.logger.info(
        `Exported ${bundle.units.length} ${bundle.units.length === 1 ? "string" : "strings"} ` +
          `for "${bundle.locale}" to ${outDir}/${bundle.locale}.xlf`,
      );
    },

    async import(context: CompilerContext) {
      const base = isAbsolute(outDir) ? outDir : join(context.root, outDir);
      if (!(await context.io.exists(base))) return [];

      const proposals: ImportedTranslation[] = [];
      for (const entry of await context.io.readEntries(base)) {
        if (entry.isDirectory() || !entry.name.endsWith(".xlf")) continue;
        proposals.push(...readUnits(await context.io.readFile(join(base, entry.name))));
      }
      return proposals;
    },
  };
}
