/**
 * Smart Catalog Reconciliation
 *
 * Compares old and new manifest states to detect renames, deletes, and moves
 * so that existing translations are preserved or migrated automatically.
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
// type CatalogMap = Record<string, Record<string, string>>; // locale → { text → translation }

// Below this similarity ratio, a change is treated as a brand-new string (not a rename).
/** Single source of truth for the reconciliation similarity threshold. */
export const DEFAULT_RENAME_THRESHOLD = 0.6;

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

// ─── Core reconciliation ─────────────────────────────────────────────────────

export interface ReconcileResult {
  /** boundary → locale → { old text keys to rename to new text key } */
  renames: Record<string, Record<string, Record<string, string>>>;
  /** boundary → locale → { text key → { oldVar: newVar } } */
  varMappings: Record<string, Record<string, Record<string, Record<string, string>>>>;
  /** boundary → locale → set of text keys to delete */
  deletes: Record<string, Set<string>>;
  /** Moves: { fromBoundary, toBoundary, text } */
  moves: Array<{ fromBoundary: string; toBoundary: string; text: string }>;
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
  };

  // Build a global text→boundaries index for the current manifest
  const currentGlobalIndex = new Map<string, string[]>(); // text → [boundaryId…]
  for (const [bId, messages] of Object.entries(currentManifest)) {
    for (const msg of messages) {
      if (!currentGlobalIndex.has(msg.text)) currentGlobalIndex.set(msg.text, []);
      currentGlobalIndex.get(msg.text)!.push(bId);
    }
  }

  // Collect all boundaries (old ∪ new) to process
  const allBoundaries = new Set([
    ...Object.keys(previousManifest),
    ...Object.keys(currentManifest),
  ]);

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
    for (const rem of removed) {
      let bestScore = 0;
      let bestAdd: ManifestEntry | null = null;

      for (const add of added) {
        if (usedAdded.has(add.text)) continue;
        const score = similarity(rem.text, add.text);
        if (score >= threshold && score > bestScore) {
          bestScore = score;
          bestAdd = add;
        }
      }

      if (bestAdd) {
        usedAdded.add(bestAdd.text);
        usedRemoved.add(rem.text);

        // Record rename for this boundary across all locales
        if (!result.renames[bId]) result.renames[bId] = {};
        // We'll fill locales when applying; store the mapping at boundary level
        if (!result.renames[bId]["*"]) result.renames[bId]["*"] = {};
        result.renames[bId]["*"][rem.text] = bestAdd.text;

        // Detect variable shifts
        const oldVars = rem.variables || [];
        const newVars = bestAdd.variables || [];
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
            result.varMappings[bId]["*"][bestAdd.text] = mapping;
          }
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
