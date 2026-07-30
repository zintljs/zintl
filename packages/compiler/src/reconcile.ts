/**
 * Smart Catalog Reconciliation
 *
 * Compares old and new manifest states to detect renames, deletes, and moves
 * so that existing translations are preserved or migrated automatically.
 *
 * ## Why this matters
 *
 * Catalog keys derive from the source text, so editing a string produces a new
 * key. Without this diff, fixing a typo would orphan that string's translations
 * in every target locale. Reconciliation is what makes ordinary copy edits safe.
 *
 * ## The two failure modes are not symmetric
 *
 * A **missed rename** is cushioned: the translation memory (the "hive") is
 * append-only and keyed by source text globally, so the old translation is never
 * destroyed and `CatalogManager` will restore it if that text reappears. The cost
 * is a string rendering untranslated until someone retranslates the new wording.
 *
 * A **wrong rename** is not cushioned. The old translation is written into the
 * catalog under the new source text and then memorized into the hive, so a single
 * bad match propagates. Edit distance cannot tell `"Enable notifications"` from
 * `"Disable notifications"` — they are ~0.86 similar — and no threshold will fix
 * that, because the same edit size covers both a spelling fix and a negation.
 *
 * So this module does not try to be clever. It keeps matching conservative and
 * deterministic, and it *reports* every carry-forward so a wrong one is visible
 * rather than silent. See `ReconcileResult.renamed`.
 */

type ManifestEntry = {
  id: string;
  text: string;
  context: string;
  boundaryId: string;
  location: any;
  variables?: string[];
};
export type Manifest = Record<string, ManifestEntry[]>;

// Below this similarity ratio, a change is treated as a brand-new string (not a rename).
/** Single source of truth for the reconciliation similarity threshold. */
export const DEFAULT_RENAME_THRESHOLD = 0.6;

/**
 * Minimum edit budget, regardless of how short the strings are.
 *
 * A pure ratio has a cliff at the short end: `"OK"` → `"Ok"` is one edit over
 * two characters, i.e. 0.5 similarity, so a casing fix on a two-letter button
 * used to be classified as a delete. Two-character UI strings ("OK", "No", "Go")
 * are common enough that this was worth a floor.
 */
const MIN_EDIT_BUDGET = 1;

// ─── Levenshtein distance ────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Whether two texts are close enough to be treated as the same string, edited.
 *
 * Equivalent to `similarity(a, b) >= threshold` except for the short-string
 * floor described on {@link MIN_EDIT_BUDGET}.
 */
export function isRenameCandidate(
  a: string,
  b: string,
  threshold: number = DEFAULT_RENAME_THRESHOLD,
): boolean {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;

  const distance = levenshtein(a, b);
  if (threshold >= 1) return distance === 0;

  const budget = Math.max(MIN_EDIT_BUDGET, (1 - threshold) * maxLen);
  return distance <= budget;
}

// ─── Risk signal ─────────────────────────────────────────────────────────────

/** Lowercased, punctuation-stripped word set. */
function wordSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  return new Set(words);
}

/**
 * Whether a rename *substituted* a word rather than merely editing characters,
 * adding a word, or changing punctuation.
 *
 * This is the closest cheap proxy for "the meaning may have changed". A pure
 * character edit (`"application!"` → `"application."`) or a pure addition
 * (`"Get started"` → `"Get started now"`) leaves the shared vocabulary intact.
 * A substitution (`"Enable …"` → `"Disable …"`) does not, and that is exactly the
 * shape a negation takes. Reported, never used to reject — a spelling fix on a
 * single word looks identical and must still reconcile.
 */
export function substitutesWords(from: string, to: string): boolean {
  const before = wordSet(from);
  const after = wordSet(to);

  let removed = false;
  for (const w of before) {
    if (!after.has(w)) {
      removed = true;
      break;
    }
  }
  if (!removed) return false;

  for (const w of after) {
    if (!before.has(w)) return true;
  }
  return false;
}

// ─── Core reconciliation ─────────────────────────────────────────────────────

/** A translation carried forward from one source text to another. */
interface RenameRecord {
  boundaryId: string;
  from: string;
  to: string;
  /** Levenshtein similarity, 0–1. */
  score: number;
  /** True when a whole word was swapped — see {@link substitutesWords}. */
  substitutesWords: boolean;
}

export interface ReconcileResult {
  /** boundary → locale → { old text keys to rename to new text key } */
  renames: Record<string, Record<string, Record<string, string>>>;
  /** boundary → locale → { text key → { oldVar: newVar } } */
  varMappings: Record<string, Record<string, Record<string, Record<string, string>>>>;
  /** boundary → locale → set of text keys to delete */
  deletes: Record<string, Set<string>>;
  /** Moves: { fromBoundary, toBoundary, text } */
  moves: Array<{ fromBoundary: string; toBoundary: string; text: string }>;
  /**
   * Every carry-forward, in deterministic order, for reporting.
   *
   * A wrong entry here is the one reconciliation failure the translation memory
   * cannot undo, so callers are expected to surface these rather than apply them
   * silently.
   */
  renamed: RenameRecord[];
}

/** Deterministic string ordering — no locale sensitivity. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reconcile changes between two manifest snapshots.
 * Returns a descriptor of what needs to change in catalog files.
 */
export function reconcileManifests(
  previousManifest: Manifest,
  currentManifest: Manifest,
  threshold: number = DEFAULT_RENAME_THRESHOLD,
): ReconcileResult {
  const result: ReconcileResult = {
    renames: {},
    varMappings: {},
    deletes: {},
    moves: [],
    renamed: [],
  };

  // Build a global text→boundaries index for the current manifest
  const currentGlobalIndex = new Map<string, string[]>(); // text → [boundaryId…]
  for (const [bId, messages] of Object.entries(currentManifest)) {
    for (const msg of messages) {
      if (!currentGlobalIndex.has(msg.text)) currentGlobalIndex.set(msg.text, []);
      currentGlobalIndex.get(msg.text)!.push(bId);
    }
  }

  // Collect all boundaries (old ∪ new) to process, in a stable order.
  const allBoundaries = [
    ...new Set([...Object.keys(previousManifest), ...Object.keys(currentManifest)]),
  ].sort(compareText);

  for (const bId of allBoundaries) {
    const oldMessages = previousManifest[bId] ?? [];
    const newMessages = currentManifest[bId] ?? [];

    const oldTexts = new Set(oldMessages.map((m) => m.text));
    const newTexts = new Set(newMessages.map((m) => m.text));

    // Texts that exist in old but not in new for this boundary
    const removed = oldMessages.filter((m) => !newTexts.has(m.text));
    // Texts that exist in new but not in old for this boundary
    const added = newMessages.filter((m) => !oldTexts.has(m.text));

    const usedAdded = new Set<string>();
    const usedRemoved = new Set<string>();

    // ── Step 1: Detect renames within the same boundary ──────────────────
    //
    // Scored globally and assigned best-first, not per-removed-in-iteration-
    // order. Sequential greedy matching let manifest ordering decide which
    // string kept its translations when two candidates competed for the same
    // partner; ties now break on text, so the result is a pure function of the
    // manifests' *content*.
    const candidates: Array<{ rem: ManifestEntry; add: ManifestEntry; score: number }> = [];
    for (const rem of removed) {
      for (const add of added) {
        if (!isRenameCandidate(rem.text, add.text, threshold)) continue;
        candidates.push({ rem, add, score: similarity(rem.text, add.text) });
      }
    }
    candidates.sort(
      (x, y) =>
        y.score - x.score ||
        compareText(x.rem.text, y.rem.text) ||
        compareText(x.add.text, y.add.text),
    );

    for (const { rem, add, score } of candidates) {
      if (usedRemoved.has(rem.text) || usedAdded.has(add.text)) continue;

      usedAdded.add(add.text);
      usedRemoved.add(rem.text);

      // Record rename for this boundary across all locales
      if (!result.renames[bId]) result.renames[bId] = {};
      // We'll fill locales when applying; store the mapping at boundary level
      if (!result.renames[bId]["*"]) result.renames[bId]["*"] = {};
      result.renames[bId]["*"][rem.text] = add.text;

      result.renamed.push({
        boundaryId: bId,
        from: rem.text,
        to: add.text,
        score,
        substitutesWords: substitutesWords(rem.text, add.text),
      });

      // Detect variable shifts
      const oldVars = rem.variables || [];
      const newVars = add.variables || [];
      if (oldVars.length === newVars.length && oldVars.length > 0) {
        const mapping: Record<string, string> = {};
        let changed = false;
        for (let i = 0; i < oldVars.length; i++) {
          if (oldVars[i] !== newVars[i]) {
            mapping[oldVars[i]] = newVars[i];
            changed = true;
          }
        }
        if (changed) {
          if (!result.varMappings[bId]) result.varMappings[bId] = {};
          if (!result.varMappings[bId]["*"]) result.varMappings[bId]["*"] = {};
          result.varMappings[bId]["*"][add.text] = mapping;
        }
      }
    }

    // ── Step 2: Detect moves (still-removed texts that appear in another boundary) ─
    for (const rem of removed) {
      if (usedRemoved.has(rem.text)) continue;

      const foundIn = currentGlobalIndex.get(rem.text);
      if (foundIn && foundIn.length > 0) {
        // It moved to another boundary (pick first if multiple)
        const toBoundary = foundIn[0];
        if (toBoundary !== bId) {
          result.moves.push({ fromBoundary: bId, toBoundary, text: rem.text });
          usedRemoved.add(rem.text);
        }
      }
    }

    // ── Step 3: Remaining removed = true deletes ─────────────────────────
    for (const rem of removed) {
      if (usedRemoved.has(rem.text)) continue;
      if (!result.deletes[bId]) result.deletes[bId] = new Set();
      result.deletes[bId].add(rem.text);
    }
  }

  return result;
}
