export interface HmrPacket {
  type: string;
  timestamp: number;
  data: unknown;
}

export interface WsCapture {
  stop(): HmrPacket[];
  readonly packets: ReadonlyArray<HmrPacket>;
}

export type HmrIntercept = (onPacket: (packet: HmrPacket) => void) => () => void;

/**
 * Build an {@link HmrIntercept} that watches the page's own websocket.
 *
 * Playwright reports every socket the page opens and every frame it receives,
 * which is all this needs — no host internals, and no server object to patch.
 * `page.on("websocket")` only sees sockets opened *after* it is attached, which
 * is why the lab wires this in its constructor, before navigation.
 */
export function clientHmrIntercept(
  page: {
    on(e: "websocket", h: (ws: any) => void): void;
    off(e: "websocket", h: (ws: any) => void): void;
  },
  channel: { pathMatch: string; translate(frame: string): HmrPacket | null },
): HmrIntercept {
  return (onPacket) => {
    const onSocket = (ws: any) => {
      if (!String(ws.url?.() ?? "").includes(channel.pathMatch)) return;
      ws.on("framereceived", (frame: { payload: string | Buffer }) => {
        const raw =
          typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf-8");
        try {
          const packet = channel.translate(raw);
          if (packet) onPacket(packet);
        } catch {
          // A frame this host does not describe is not a test failure.
        }
      });
    };
    page.on("websocket", onSocket);
    return () => page.off("websocket", onSocket);
  };
}

export class LabWebSocket {
  private intercept?: HmrIntercept;
  private activeCaptures: Set<{ packets: HmrPacket[] }> = new Set();
  private detach?: () => void;
  private listeners: Set<(packet: HmrPacket) => void> = new Set();

  private static readonly RECENT_LIMIT = 50;
  private readonly recent: HmrPacket[] = [];

  /**
   * Rolling log of packets the dev server pushed, independent of any capture.
   *
   * Captures must be started before the interesting moment, which is no help
   * when diagnosing a failure after the fact. This answers the first question
   * of any stalled-update investigation — did the server send anything at all?
   * — and so distinguishes "never sent" from "sent but never applied".
   */
  get recentPackets(): ReadonlyArray<HmrPacket> {
    return this.recent;
  }

  /**
   * Takes an intercept function rather than a server, so it no longer knows
   * what a `ViteDevServer` is.
   *
   * Absent means the host does not expose a hot-update channel the lab can
   * watch — not that nothing was sent. Contracts requiring `hmr` are kept away
   * from such projects by the capability model, so the distinction never has to
   * be guessed at from an empty packet list.
   */
  constructor(intercept?: HmrIntercept) {
    this.intercept = intercept;
    if (intercept) {
      this.setupIntercept();
    }
  }

  private setupIntercept() {
    if (!this.intercept) return;
    this.detach = this.intercept((packet) => {
      this.recent.push(packet);
      if (this.recent.length > LabWebSocket.RECENT_LIMIT) {
        this.recent.shift();
      }
      for (const capture of this.activeCaptures) {
        capture.packets.push(packet);
      }
      for (const listener of this.listeners) {
        listener(packet);
      }
    });
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
    this.detach?.();
    this.detach = undefined;
  }
}
