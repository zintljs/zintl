/**
 * Reconciliation is the one subsystem where a silent mistake costs translator
 * work, so these tests care as much about how it behaves when it is *wrong* as
 * when it is right.
 *
 * The two failure modes are asymmetric, and the tests are grouped to reflect it:
 *
 * - A **missed rename** is cushioned by the hive (append-only, keyed by source
 *   text), so the old translation survives and the new wording simply renders
 *   untranslated.
 * - A **wrong rename** is not cushioned — the old translation is written under
 *   the new text and memorized — so it must at minimum be *reported*.
 */
import { describe, it, expect } from "vite-plus/test";
import {
  DEFAULT_RENAME_THRESHOLD,
  isRenameCandidate,
  reconcileManifests,
  similarity,
  substitutesWords,
  type Manifest,
} from "../reconcile.js";
import { MessageManager } from "../managers/MessageManager.js";

const msg = (text: string, boundaryId: string, variables?: string[]) => ({
  id: text,
  text,
  context: "",
  boundaryId,
  location: {},
  ...(variables ? { variables } : {}),
});

const manifest = (entries: Record<string, string[]>): Manifest =>
  Object.fromEntries(
    Object.entries(entries).map(([bId, texts]) => [bId, texts.map((t) => msg(t, bId))]),
  );

describe("Catalog Reconciliation", () => {
  it("should detect a move between boundaries", () => {
    const result = reconcileManifests(
      manifest({ "src/A": ["Hello"], "src/B": [] }),
      manifest({ "src/A": [], "src/B": ["Hello"] }),
    );
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toEqual({
      fromBoundary: "src/A",
      toBoundary: "src/B",
      text: "Hello",
    });
  });

  it("should detect a true delete", () => {
    const result = reconcileManifests(manifest({ "src/A": ["Hello"] }), manifest({ "src/A": [] }));
    expect(result.deletes["src/A"]?.has("Hello")).toBe(true);
  });

  it("should not detect a delete if it matches a rename", () => {
    const result = reconcileManifests(
      manifest({ "src/A": ["Welcome to our application!"] }),
      manifest({ "src/A": ["Welcome to our application."] }),
      0.6,
    );
    expect(result.renames["src/A"]["*"]["Welcome to our application!"]).toBe(
      "Welcome to our application.",
    );
    expect(result.deletes["src/A"]).toBeUndefined();
  });

  it("remaps positional variables when a rename shifts them", () => {
    const prev: Manifest = {
      "src/A": [msg("Hi {name}, you have {count}", "src/A", ["name", "count"])],
    };
    const curr: Manifest = {
      "src/A": [msg("Hi {user}, you have {count}", "src/A", ["user", "count"])],
    };

    const result = reconcileManifests(prev, curr);
    expect(result.varMappings["src/A"]["*"]["Hi {user}, you have {count}"]).toEqual({
      name: "user",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("short-string edit budget", () => {
  it("treats a casing fix on a two-letter string as a rename", () => {
    // 1 edit over 2 characters is 0.5 similarity — under the 0.6 ratio. A pure
    // ratio classified this as a delete, and two-character labels are common.
    expect(similarity("OK", "Ok")).toBeLessThan(DEFAULT_RENAME_THRESHOLD);
    expect(isRenameCandidate("OK", "Ok")).toBe(true);

    const result = reconcileManifests(manifest({ "src/A": ["OK"] }), manifest({ "src/A": ["Ok"] }));
    expect(result.renames["src/A"]["*"]["OK"]).toBe("Ok");
    expect(result.deletes["src/A"]).toBeUndefined();
  });

  it("still refuses two unrelated short strings", () => {
    // "OK" → "No" is two edits; the floor is one.
    expect(isRenameCandidate("OK", "No")).toBe(false);

    const result = reconcileManifests(manifest({ "src/A": ["OK"] }), manifest({ "src/A": ["No"] }));
    expect(result.deletes["src/A"]?.has("OK")).toBe(true);
    expect(result.renamed).toEqual([]);
  });

  it("leaves longer strings on the ratio, unchanged", () => {
    // The floor only ever relaxes the budget, and only where the ratio rounds
    // below one edit. Anything three characters or longer behaves as before.
    for (const [a, b] of [
      ["Yes", "yes"],
      ["Save", "Saved"],
      ["Documentation", "Documentaton"],
    ]) {
      expect(isRenameCandidate(a, b)).toBe(similarity(a, b) >= DEFAULT_RENAME_THRESHOLD);
    }
  });

  it("honours an exact-match threshold of 1", () => {
    expect(isRenameCandidate("OK", "Ok", 1)).toBe(false);
    expect(isRenameCandidate("OK", "OK", 1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("word-substitution reporting", () => {
  it("flags a negation that edit distance cannot catch", () => {
    // ~0.86 similar: comfortably a "rename" by any threshold that still allows
    // ordinary typo fixes. The translation *will* be carried forward; the point
    // is that it must not happen silently.
    expect(similarity("Enable notifications", "Disable notifications")).toBeGreaterThan(0.8);

    const result = reconcileManifests(
      manifest({ "src/A": ["Enable notifications"] }),
      manifest({ "src/A": ["Disable notifications"] }),
    );

    expect(result.renamed).toHaveLength(1);
    expect(result.renamed[0]).toMatchObject({
      from: "Enable notifications",
      to: "Disable notifications",
      substitutesWords: true,
    });
  });

  it("does not flag punctuation-only edits", () => {
    expect(substitutesWords("Welcome to our application!", "Welcome to our application.")).toBe(
      false,
    );
  });

  it("does not flag a pure addition", () => {
    expect(substitutesWords("Get started", "Get started now")).toBe(false);
  });

  it("does not flag a pure removal", () => {
    expect(substitutesWords("Get started now", "Get started")).toBe(false);
  });

  it("flags a single-word substitution", () => {
    expect(substitutesWords("Submit", "Cancel")).toBe(true);
  });

  it("reports every carry-forward, flagged or not", () => {
    const result = reconcileManifests(
      manifest({ "src/A": ["Welcome to our application!", "Enable notifications"] }),
      manifest({ "src/A": ["Welcome to our application.", "Disable notifications"] }),
    );

    expect(result.renamed).toHaveLength(2);
    expect(result.renamed.every((r) => r.score > 0 && r.score <= 1)).toBe(true);
    // Exactly one is risky, and it is the one where a word changed.
    expect(result.renamed.filter((r) => r.substitutesWords).map((r) => r.to)).toEqual([
      "Disable notifications",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("properties", () => {
  /** Every text that had a translation must still be reachable afterwards. */
  const survives = (result: ReturnType<typeof reconcileManifests>, text: string, bId: string) => {
    const renamed = result.renames[bId]?.["*"]?.[text] !== undefined;
    const moved = result.moves.some((m) => m.text === text && m.fromBoundary === bId);
    const deleted = result.deletes[bId]?.has(text) ?? false;
    return { renamed, moved, deleted };
  };

  it("classifies every removed text exactly once", () => {
    const prev = manifest({ "src/A": ["Alpha", "Beta", "Gamma", "Delta"] });
    const curr = manifest({ "src/A": ["Alpha", "Betaa"], "src/B": ["Gamma"] });

    const result = reconcileManifests(prev, curr);

    for (const text of ["Beta", "Gamma", "Delta"]) {
      const { renamed, moved, deleted } = survives(result, text, "src/A");
      expect([renamed, moved, deleted].filter(Boolean)).toHaveLength(1);
    }
    // "Alpha" was untouched, so it is in no bucket at all.
    expect(survives(result, "Alpha", "src/A")).toEqual({
      renamed: false,
      moved: false,
      deleted: false,
    });
  });

  it("is invariant under manifest ordering", () => {
    // Sequential greedy matching let iteration order decide which string kept
    // its translations when two competed for the same partner.
    const texts = ["Save changes", "Save change", "Saved changes"];
    const forward = manifest({ "src/A": texts });
    const backward = manifest({ "src/A": [...texts].reverse() });

    const target = manifest({ "src/A": ["Save changed"] });

    const a = reconcileManifests(forward, target);
    const b = reconcileManifests(backward, target);

    expect(a.renames).toEqual(b.renames);
    expect(a.renamed).toEqual(b.renamed);
    expect([...(a.deletes["src/A"] ?? [])].sort()).toEqual([...(b.deletes["src/A"] ?? [])].sort());
  });

  it("is invariant under boundary ordering", () => {
    const a = reconcileManifests(
      manifest({ "src/A": ["Hello"], "src/B": ["World"] }),
      manifest({ "src/A": ["Hello!"], "src/B": ["World!"] }),
    );
    const b = reconcileManifests(
      manifest({ "src/B": ["World"], "src/A": ["Hello"] }),
      manifest({ "src/B": ["World!"], "src/A": ["Hello!"] }),
    );
    expect(a.renamed).toEqual(b.renamed);
  });

  it("never pairs one text with two partners", () => {
    const result = reconcileManifests(
      manifest({ "src/A": ["Colour", "Colours"] }),
      manifest({ "src/A": ["Color", "Colors"] }),
    );

    const froms = result.renamed.map((r) => r.from);
    const tos = result.renamed.map((r) => r.to);
    expect(new Set(froms).size).toBe(froms.length);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("prefers the closest partner when several are eligible", () => {
    // "Save changes" is nearer to "Save change" than "Saved changes" is.
    const result = reconcileManifests(
      manifest({ "src/A": ["Save changes", "Saved changes"] }),
      manifest({ "src/A": ["Save change"] }),
    );
    expect(result.renamed).toHaveLength(1);
    expect(result.renamed[0].from).toBe("Save changes");
  });

  it("produces no renames, moves or deletes for an unchanged manifest", () => {
    const m = manifest({ "src/A": ["Hello", "World"], "src/B": ["Goodbye"] });
    const result = reconcileManifests(m, m);
    expect(result.renamed).toEqual([]);
    expect(result.moves).toEqual([]);
    expect(result.deletes).toEqual({});
  });

  it("treats every text in a brand-new boundary as added, never as a delete", () => {
    const result = reconcileManifests(manifest({}), manifest({ "src/A": ["Hello"] }));
    expect(result.deletes).toEqual({});
    expect(result.renamed).toEqual([]);
  });

  it("is symmetric in its similarity scoring", () => {
    for (const [a, b] of [
      ["Enable", "Disable"],
      ["OK", "Ok"],
      ["", "Hello"],
    ]) {
      expect(similarity(a, b)).toBe(similarity(b, a));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("reconciliation reporting", () => {
  const entry = (text: string) => ({
    id: text,
    text,
    context: "",
    boundaryId: "b",
    location: {},
  });

  function run(previous: string[], current: string[]) {
    const warns: string[] = [];
    const debugs: string[] = [];
    const logger = {
      warn: (m: string) => warns.push(m),
      debug: (m: string) => debugs.push(m),
    };

    const messages = new MessageManager({} as any, undefined, logger as any);
    messages.previousManifest = { b: previous.map(entry) };
    messages.internalManifest = { b: current.map(entry) };

    return { result: messages.reconcile(), warns, debugs };
  }

  it("warns when a rename substituted a word", () => {
    const { warns } = run(["Enable alerts"], ["Disable alerts"]);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Disable alerts");
    expect(warns[0]).toContain("word was substituted");
  });

  it("does not warn for an ordinary edit, but still records it", () => {
    const { warns, debugs } = run(["Welcome home!"], ["Welcome home."]);

    expect(warns).toEqual([]);
    expect(debugs.some((d) => d.includes("Welcome home."))).toBe(true);
  });

  it("says nothing at all when nothing was carried forward", () => {
    const { result, warns, debugs } = run(["Hello"], ["Hello"]);

    expect(result.renamed).toEqual([]);
    expect(warns).toEqual([]);
    expect(debugs).toEqual([]);
  });

  it("stays silent about deletes, which the hive already cushions", () => {
    const { result, warns } = run(["Something removed entirely"], []);

    expect(result.deletes["b"]?.has("Something removed entirely")).toBe(true);
    expect(warns).toEqual([]);
  });
});
