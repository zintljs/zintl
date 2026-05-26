import { reconcileManifests, type Manifest, type ReconcileResult } from "../reconcile.js";
import type { IOManager } from "./IOManager.js";
import { SAVE_DEBOUNCE_MS } from "../constants.js";
import { sortObjectKeys } from "../utils/serialization.js";

/**
 * Manages translation messages, manifests, and the global hive.
 */
export class MessageManager {
  public internalManifest: Manifest = {};
  public previousManifest: Manifest = {};
  public dependencyGraph: Record<string, any[]> = {};
  public metadataGraph: Record<string, any> = {};
  public hive: Record<string, Record<string, any>> = {};
  public hiveDirty = false;
  public lastOutputDir?: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  public boundaryOwnership = new Map<string, Set<string>>();
  public dirtyBoundaries = new Set<string>();
  public currentReconciliation?: ReconcileResult;
  private lastManifestContent: string | null = null;

  constructor(
    private readonly io: IOManager,
    private readonly threshold?: number,
    private readonly logger?: any,
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
    for (const bId of boundaryIds) this.dirtyBoundaries.add(bId);
  }

  public reconcile(): ReconcileResult {
    const changes = reconcileManifests(
      this.previousManifest,
      this.internalManifest,
      this.threshold,
    );
    this.currentReconciliation = changes;
    return changes;
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

  public async saveManifest(outputDir?: string) {
    this.logger?.debug("Saving compiler manifest...");
    const data = {
      manifest: this.internalManifest,
      graph: this.dependencyGraph,
      metadata: this.metadataGraph,
      outputDir,
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
