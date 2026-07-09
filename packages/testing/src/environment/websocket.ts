/* eslint-disable @typescript-eslint/unbound-method */
import type { ViteDevServer } from "vite";

export interface HmrPacket {
  type: string;
  timestamp: number;
  data: unknown;
}

export interface WsCapture {
  stop(): HmrPacket[];
  readonly packets: ReadonlyArray<HmrPacket>;
}

export class LabWebSocket {
  private server?: ViteDevServer;
  private activeCaptures: Set<{ packets: HmrPacket[] }> = new Set();
  private originalSend?: Function;
  private listeners: Set<(packet: HmrPacket) => void> = new Set();

  constructor(server?: ViteDevServer) {
    this.server = server;
    if (server) {
      this.setupIntercept();
    }
  }

  private setupIntercept() {
    if (!this.server) return;
    const ws = this.server.ws;
    this.originalSend = ws.send;

    // Monkey-patch ws.send to intercept outgoing HMR packets
    ws.send = (payload: any, ...args: any[]) => {
      let packet: HmrPacket | null = null;
      try {
        const data = typeof payload === "string" ? JSON.parse(payload) : payload;
        if (data && typeof data.type === "string") {
          packet = {
            type: data.type,
            timestamp: Date.now(),
            data,
          };
        }
      } catch {
        // Ignore invalid payloads
      }

      if (packet) {
        for (const capture of this.activeCaptures) {
          capture.packets.push(packet);
        }
        for (const listener of this.listeners) {
          listener(packet);
        }
      }

      return this.originalSend!.call(ws, payload, ...args);
    };
  }

  capture(): WsCapture {
    const packets: HmrPacket[] = [];
    const captureObj = { packets };
    this.activeCaptures.add(captureObj);

    return {
      stop: () => {
        this.activeCaptures.delete(captureObj);
        return packets;
      },
      get packets() {
        return packets;
      },
    };
  }

  async waitFor(
    type: "update" | "full-reload" | "prune" | "connected",
    opts?: { timeout?: number },
  ): Promise<HmrPacket> {
    const timeoutMs = opts?.timeout ?? 10000;
    return new Promise<HmrPacket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Timeout waiting for HMR packet of type: ${type}`));
      }, timeoutMs);

      const listener = (packet: HmrPacket) => {
        if (packet.type === type) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(packet);
        }
      };

      this.listeners.add(listener);
    });
  }

  teardown() {
    if (this.server && this.originalSend) {
      this.server.ws.send = this.originalSend as any;
    }
  }
}
