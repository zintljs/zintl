import type { ViteDevServer } from "vite";
import type { ZintlCompiler } from "@zintl/compiler";

export class LabCompiler {
  private server?: ViteDevServer;

  constructor(server?: ViteDevServer) {
    this.server = server;
  }

  get instance(): ZintlCompiler | undefined {
    const contexts = (globalThis as any).__zintl_active_contexts || [];
    if (this.server) {
      const serverRoot = this.server.config.root;
      const match = contexts.find(
        (ctx: any) => ctx.server === this.server || ctx.compiler?.root === serverRoot,
      );
      if (match) return match.compiler;
    }
    return contexts[contexts.length - 1]?.compiler;
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
