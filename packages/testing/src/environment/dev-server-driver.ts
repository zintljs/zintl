import type { HmrPacket } from "./websocket.js";

/**
 * A hot-update channel the lab watches from the **browser** rather than the
 * server.
 *
 * The alternative to `interceptHmr` for a host whose socket is not a patchable
 * server object. Rsbuild is one: its `socketServer` sits on an internal context
 * that `initPluginAPI` narrows away before any plugin sees it, so there is
 * nothing to monkey-patch without reaching past the public API.
 *
 * Watching from the client is not merely the available option, it is the better
 * evidence — it records what the page actually *received*, which is what every
 * contract using these packets is really asking about. The server-side path
 * stays for Vite because it already works and because its packets are visible
 * even before a page exists.
 */
interface ClientHmrChannel {
  /** Substring identifying this host's hot-update websocket URL. */
  pathMatch: string;
  /**
   * Translate one received frame into the lab's vocabulary, or `null` to ignore
   * it. Hosts disagree on payload names — Rsbuild's `ok` is Vite's `update` —
   * and reconciling that is the driver's job, not the contract's.
   */
  translate(frame: string): HmrPacket | null;
}

/**
 * A running dev server, described in terms the lab needs rather than in terms
 * of whichever tool started it.
 *
 * `interceptHmr` is optional on purpose, and it is the honest part of this
 * interface. Vite exposes its hot-update channel as a patchable `ws.send`;
 * other hosts do not, and pretending otherwise would mean a lab quietly
 * reporting "no packets" where it means "cannot see packets". A host that
 * cannot offer it simply omits it, and the capability model keeps the contracts
 * that need packets away from that project.
 */
export interface LabDevServerHandle {
  /** Base URL the browser should navigate to. */
  url: string;
  /**
   * The host's own server object, for the few places that genuinely need it.
   *
   * Deliberately `unknown`: reaching into it is a host-specific act and should
   * look like one at the call site.
   */
  native?: unknown;
  /** Project root this server is serving. */
  root: string;
  /** Subscribe to outgoing hot-update packets. Returns an unsubscribe. */
  interceptHmr?(onPacket: (packet: HmrPacket) => void): () => void;
  /**
   * The client-side alternative to {@link interceptHmr}, for a host with no
   * patchable server socket. Used only when `interceptHmr` is absent.
   */
  clientHmr?: ClientHmrChannel;
  close(): Promise<void>;
}

/**
 * Starts dev servers for one build tool.
 *
 * The counterpart to `BuildToolDriver`, which already covers the build side.
 * Together they are what lets a contract run against a second host without
 * naming it — the contract asks for capabilities, the manifest names a driver,
 * and nothing in between knows which tool is serving.
 */
export interface DevServerDriver {
  readonly name: string;
  start(root: string, projectName: string, port: number): Promise<LabDevServerHandle>;
}
