import type { ZintlCompiler } from "@zintljs/compiler";

export class LabCompiler {
  private root?: string;

  /**
   * Identified by project root rather than by a server object.
   *
   * Matching on the server meant knowing what kind of server it was; the root
   * is what actually distinguishes one compiler from another, it is what the
   * compiler itself records, and every host has one.
   */
  constructor(root?: string) {
    this.root = root;
  }

  /** The live plugin `Context` this lab's dev server is running, if any. */
  private context(): any {
    const contexts = (globalThis as any).__zintl_active_contexts || [];
    if (this.root) {
      const match = contexts.find(
        (ctx: any) => ctx.compiler?.rootDir === this.root || ctx.compiler?.root === this.root,
      );
      if (match) return match;
    }
    return contexts[contexts.length - 1];
  }

  get instance(): ZintlCompiler | undefined {
    return this.context()?.compiler;
  }

  /**
   * `handleHotUpdateHook`'s own trace of every hot-update invocation for this
   * project — oldest first. See `HmrTraceEntry` (`packages/zintl/src/context.ts`).
   * Empty outside dev mode, or before anything has triggered a hot update.
   */
  get hmrTrace(): any[] {
    return this.context()?.hmrTrace?.toArray() ?? [];
  }

  /**
   * Whether re-running this project's entry module is safe.
   *
   * The flag ZHMR §4.2's exception turns on: where it holds, a structural
   * change can be hot-replaced because the re-executed entry rebuilds the
   * boundary map itself, and the compiler emits a self-accepting snippet
   * instead of forcing a reload. It is resolved from the framework's runtime
   * facet, so it is a **compiler fact, not a project one** — a contract that
   * asked a manifest to declare it would be asking twenty adapters to restate
   * something the compiler already knows.
   */
  get entryReexecutionSafe(): boolean {
    return this.instance?._resolved?.flags?.entryReexecutionSafe ?? false;
  }

  getBoundaryGraph() {
    const inst = this.instance;
    if (!inst) throw new Error("Zintl compiler not active in current server mode");
    return (inst as any).boundaryGraph || (inst as any).graph?.boundaryGraph;
  }

  getChunkGraph() {
    const inst = this.instance;
    if (!inst) throw new Error("Zintl compiler not active in current server mode");
    return (inst as any)._chunkGraph || (inst as any).graph?.chunkGraph;
  }

  hasBoundary(filePath: string): boolean {
    const inst = this.instance;
    if (!inst) return false;
    const bg = this.getBoundaryGraph();
    if (!bg) return false;

    if (bg.nodes.has(filePath)) return true;
    const safeId = inst.getSafeBoundaryId(filePath);
    if (bg.nodes.has(safeId)) return true;

    for (const nodeId of bg.nodes.keys()) {
      if (inst.getSafeBoundaryId(nodeId) === safeId || nodeId === safeId || nodeId === filePath) {
        return true;
      }
    }
    return false;
  }

  getSafeBoundaryId(filePath: string): string {
    const inst = this.instance;
    if (!inst) throw new Error("Zintl compiler not active");
    return inst.getSafeBoundaryId(filePath);
  }

  getAffectedChunks(boundaryId: string): string[] {
    const inst = this.instance;
    if (!inst) return [];
    return inst.getAffectedChunks(boundaryId);
  }

  getManifest(): Record<string, any[]> {
    const inst = this.instance;
    if (!inst) return {};
    return inst.internalManifest || {};
  }
}
