import { reconcileManifests, type Manifest, type ReconcileResult } from "../reconcile.js";
import type { IOManager } from "./IOManager.js";
import { SAVE_DEBOUNCE_MS } from "../constants.js";
import { sortObjectKeys } from "../utils/serialization.js";
import type { DependencyGraph, MetadataGraph } from "../types/graph.js";
import type { ZintlLogger } from "../types/compiler.js";

/**
 * Manages translation messages, manifests, and the global hive.
 */
export class MessageManager {
  public internalManifest: Manifest = {};
  public previousManifest: Manifest = {};
  public dependencyGraph: DependencyGraph = {};
  public metadataGraph: MetadataGraph = {};
  public hive: Record<string, Record<string, string>> = {};
  public hiveDirty = false;
  public lastOutputDir?: string;
  public registeredAssets: string[] = [];
  public savedContentStates: Record<string, unknown> = {};
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  public boundaryOwnership = new Map<string, Set<string>>();
  public dirtyBoundaries = new Set<string>();
  /**
   * `(boundary id) → times marked dirty.`
   *
   * A flush snapshots this alongside `dirtyBoundaries` when it adopts a
   * boundary, so it can tell — after its own async catalog write — whether a
   * *newer* edit landed for that same id while it was writing. Without this,
   * `runFlush`'s cleanup deleted an adopted id unconditionally, which
   * discarded exactly that newer edit: it deleted the dirty flag a fresher
   * `markDirty` had just set, and nothing was left to schedule the boundary
   * for a later flush. See `runFlush`.
   */
  public dirtyRevisions = new Map<string, number>();
  public currentReconciliation?: ReconcileResult;
  private lastManifestContent: string | null = null;

  constructor(
    private readonly io: IOManager,
    private readonly threshold?: number,
    private readonly logger?: ZintlLogger,
  ) {}

  public async loadMetadata() {
    this.logger?.debug("Loading compiler metadata...");
    if (await this.io.exists(this.io.manifestPath)) {
      try {
        const raw = await this.io.readFile(this.io.manifestPath);
        const data = JSON.parse(raw);
        this.internalManifest = data.manifest || {};
        this.dependencyGraph = data.graph || {};
        this.metadataGraph = data.metadata || {};
        this.lastOutputDir = data.outputDir;
        this.registeredAssets = data.assets || [];
        this.savedContentStates = data.contentStates || {};
        if (data.assets && !this.savedContentStates["system-static-assets"]) {
          this.savedContentStates["system-static-assets"] = data.assets;
        }
        this.previousManifest = { ...this.internalManifest };
        this.lastManifestContent = raw;
      } catch {}
    }
    if (await this.io.exists(this.io.hivePath)) {
      try {
        this.hive = JSON.parse(await this.io.readFile(this.io.hivePath));
        this.logger?.debug(`Loaded hive with ${Object.keys(this.hive).length} entries`);
      } catch {}
    }
  }

  public trackBoundaryChange(fileId: string, boundaryIds: Set<string>) {
    const oldBoundaries = this.boundaryOwnership.get(fileId);
    if (oldBoundaries) {
      for (const bId of oldBoundaries) if (!boundaryIds.has(bId)) delete this.internalManifest[bId];
    }
    this.boundaryOwnership.set(fileId, boundaryIds);
    for (const bId of boundaryIds) this.markDirty(bId);
  }

  /** The one place a boundary becomes dirty — see `dirtyRevisions`. */
  public markDirty(bId: string) {
    this.dirtyBoundaries.add(bId);
    this.dirtyRevisions.set(bId, (this.dirtyRevisions.get(bId) ?? 0) + 1);
  }

  public reconcile(): ReconcileResult {
    const changes = reconcileManifests(
      this.previousManifest,
      this.internalManifest,
      this.threshold,
    );
    this.reportRenames(changes);
    this.currentReconciliation = changes;
    return changes;
  }

  /**
   * Surface every translation carried from one source text to another.
   *
   * Deletes are deliberately not reported: the hive is append-only, so a missed
   * rename never destroys a translation — it only leaves the new wording
   * untranslated until someone fills it in. A *wrong* rename is the failure the
   * hive cannot undo, because the old translation is written under the new text
   * and then memorized. Those are the ones worth a developer's attention.
   */
  private reportRenames(changes: ReconcileResult) {
    if (!this.logger || changes.renamed.length === 0) return;

    for (const r of changes.renamed) {
      const score = r.score.toFixed(2);
      if (r.substitutesWords) {
        this.logger.warn?.(
          `Carried translations from "${r.from}" to "${r.to}" (similarity ${score}), ` +
            `but a word was substituted rather than edited — verify the meaning still matches. ` +
            `If these are different strings, the old translations remain recoverable from the hive.`,
        );
      } else {
        this.logger.debug?.(
          `Reconciled "${r.from}" → "${r.to}" (similarity ${score}) in ${r.boundaryId}`,
        );
      }
    }
  }

  public commitReconciliation() {
    this.previousManifest = { ...this.internalManifest };
    this.currentReconciliation = undefined;
  }

  public async flushHive() {
    if (!this.hiveDirty) return;
    this.logger?.debug("Flushing translation hive...");
    await this.io.safeWriteFile(this.io.hivePath, JSON.stringify(this.hive, null, 2));
    this.hiveDirty = false;
  }

  public async saveManifest(outputDir?: string, contentStates?: Record<string, unknown>) {
    this.logger?.debug("Saving compiler manifest...");
    const data = {
      manifest: this.internalManifest,
      graph: this.dependencyGraph,
      metadata: this.metadataGraph,
      outputDir,
      assets: contentStates?.["system-static-assets"] || this.registeredAssets,
      contentStates: contentStates || this.savedContentStates,
    };
    const sortedData = sortObjectKeys(data);
    const content = JSON.stringify(sortedData, null, 2);
    if (this.lastManifestContent === content) return;
    this.lastManifestContent = content;

    await this.io.safeWriteFile(this.io.manifestPath, content);
    this.lastOutputDir = outputDir;
  }

  public markHiveDirty() {
    this.hiveDirty = true;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.flushHive(), SAVE_DEBOUNCE_MS);
  }
}
