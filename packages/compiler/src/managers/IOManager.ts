import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, stat, readdir } from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

import { calculateBoundaryId, calculateSafeBoundaryId, sha1 } from "../utils/hashing.js";
import { toPosixPath } from "../utils/paths.js";
import {
  COMPILER_METADATA_DIR,
  MANIFEST_FILENAME,
  HIVE_FILENAME,
  WRITE_GUARD_DELAY_MS,
} from "../constants.js";
import type { ZintlFacet, ZintlLogger } from "../types/index.js";
import type { DeliveryBus } from "../bus/index.js";

/** The only slice of compiler options the I/O layer actually reads. */
export interface IOManagerOptions {
  metadataDir?: string;
}

/**
 * Handles all I/O operations, formatting, and hashing.
 */
export class IOManager {
  public manifestPath: string;
  public hivePath: string;
  public readonly writingFiles = new Set<string>();
  /**
   * What the compiler believes is at a path, as content signatures.
   *
   * The companion to {@link writingFiles}, and the half that does not expire.
   * `writingFiles` is a {@link WRITE_GUARD_DELAY_MS} window, and Corollary D1a
   * (`docs/spec/ZDB.md`) says a window is never a guard. Used as one it fails in
   * both directions, and the interesting one is measurable: instrumenting a
   * single *passing* `syntax-recovery` run caught ten echoes of Zintl's own
   * writes arriving with the guard already shut, at ages of 118–209 ms against a
   * nominal 500 — because the timer is armed per write, so an early write's
   * timer closes the guard on a later one.
   *
   * But a write of Zintl's own is only half of what has to be recognised, and
   * the smaller half. The event that actually strands `syntax-recovery` is a
   * watcher report for a catalog **nobody changed** — the harness's worker copy
   * settling, chokidar's initial scan draining — arriving seconds into the test.
   * The compiler cannot tell that from a translator's edit, so it marks the
   * boundary dirty, and for `index.html.<locale>.json` that means the
   * `index.html` boundary, which `computeHotUpdatePlan` answers with a full page
   * reload.
   *
   * Land that reload during a compile error and the page cannot come back: the
   * entry fails to load, so there is no runtime and no module registered for it,
   * and the recovery edit that follows arrives as a hot `update` with nothing
   * left in the page able to accept it.
   *
   * So the question is not "did I write this" but "is this already what I have",
   * which is answered the same way whoever touched the file. The baseline is set
   * by the first {@link readFile} of a path and moved only by
   * {@link safeWriteFile}; {@link forgetWrite} drops it once an event has been
   * taken as genuine, so this can never be stickier than the window it replaces.
   *
   * Two signatures per write, because one write is two states on disk — the
   * bytes `writeFile` put there, and whatever {@link formatFile} rewrote them
   * into. Hashes rather than the content: the `memory-leak` contract measures
   * retained heap, and a catalog is not a thing to hold twice.
   */
  private readonly knownContent = new Map<string, Set<string>>();
  private detectedFormatter: { bin: string; args: string[] } | null = null;
  private readonly boundaryIdCache = new Map<string, string>();
  private readonly normalizedIdCache = new Map<string, string>();
  private readonly extensions: string[];

  /**
   * Delivery accounting for artifact writes (`docs/spec/ZDB.md`, `io/write`).
   *
   * Assigned by the compiler after construction rather than taken as another
   * positional argument — this constructor already has six, and a seventh
   * optional one that most callers ignore is how signatures rot. Optional
   * because the manager is usable without it; every write simply goes
   * unrecorded then.
   */
  public bus?: DeliveryBus;

  /** Resolved source extensions, for callers that probe extensionless dep ids. */
  public get resolvedExtensions(): readonly string[] {
    return this.extensions;
  }
  private readonly facets: ZintlFacet[];

  constructor(
    private readonly root: string,
    private readonly isDev: boolean,
    private readonly logger: ZintlLogger,
    _options: IOManagerOptions,
    resolvedExtensions: string[] = [],
    resolvedFacets: ZintlFacet[] = [],
    /**
     * Recognise one of Zintl's own generated modules.
     *
     * Supplied from the resolved system view rather than derived here, and
     * exposed through {@link IOManager.isVirtualId} so the other managers — which
     * all hold an `IOManager` and none of which hold the system view — can ask
     * the same question the same way. See ledger L-004.
     */
    private readonly virtualIdTest: (id: string) => boolean = (id) => id.includes("\0"),
  ) {
    this.extensions = resolvedExtensions;
    this.facets = resolvedFacets;
    const metaDir = this.resolveMetadataDir(_options.metadataDir);

    this.manifestPath = join(metaDir, MANIFEST_FILENAME);
    this.hivePath = join(metaDir, HIVE_FILENAME);
    this.detectFormatter();
  }

  /** Single source of truth for where compiler metadata lives. */
  private resolveMetadataDir(dir?: string): string {
    if (!dir) {
      return join(this.root, "node_modules", COMPILER_METADATA_DIR);
    }
    return isAbsolute(dir) ? dir : join(this.root, dir);
  }

  public setMetadataDir(dir?: string) {
    const metaDir = this.resolveMetadataDir(dir);

    this.manifestPath = join(metaDir, MANIFEST_FILENAME);
    this.hivePath = join(metaDir, HIVE_FILENAME);
  }

  private detectFormatter() {
    const bins = [
      {
        name: "vp",
        args: ["fmt", "[path]", "--write"],
      },
      { name: "oxfmt", args: ["[path]", "--write"] },
      { name: "prettier", args: ["--write", "[path]"] },
    ];

    for (const binConfig of bins) {
      const binPath = join(this.root, "node_modules", ".bin", binConfig.name);
      if (existsSync(binPath)) {
        this.logger.debug(`Detected formatter: ${binConfig.name}`);
        this.detectedFormatter = { bin: binPath, args: binConfig.args };
        return;
      }
    }
  }

  public getBoundaryId(boundaryId: string): string {
    return calculateBoundaryId(boundaryId, this.root, this.isDev);
  }

  public getSafeBoundaryId(boundaryId: string): string {
    if (this.boundaryIdCache.has(boundaryId)) {
      return this.boundaryIdCache.get(boundaryId)!;
    }
    const id = calculateSafeBoundaryId(boundaryId, this.root, this.isDev);
    this.boundaryIdCache.set(boundaryId, id);
    return id;
  }

  /**
   * Is this id one of Zintl's own generated modules rather than a real file?
   *
   * The single place that question is answered, for core and for every other
   * manager. Routed to the active bundler facet, because how a generated module
   * is spelled is the host's decision — Rollup's `\0`, or a materialised path
   * under `node_modules/.virtual/` on Rspack.
   */
  public isVirtualId(id: string): boolean {
    return this.virtualIdTest(id);
  }

  public getNormalizedId(id: string) {
    if (this.normalizedIdCache.has(id)) return this.normalizedIdCache.get(id)!;
    if (this.isVirtualId(id)) return id;

    const exts = this.extensions
      .map((e) => (e.startsWith(".") ? e.slice(1) : e))
      .map((e) => e.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    const regex = new RegExp(`\\.zintl-[a-zA-Z0-9_-]+\\.(${exts.join("|")})`);
    const targetId = id.replace(regex, ".$1");

    let abs: string;
    if (isAbsolute(targetId)) {
      if (targetId.startsWith(this.root)) {
        abs = targetId;
      } else {
        // Handle project-relative absolute paths (e.g. /src/main.ts in HTML)
        const projectRelative = targetId.startsWith("/") ? targetId.slice(1) : targetId;
        abs = join(this.root, projectRelative);
      }
    } else {
      abs = join(this.root, targetId);
    }

    const rel = toPosixPath(relative(this.root, abs));

    const sfcExts = (this.facets || [])
      .map((a) => {
        if (a.concern !== "codegen") return [];
        const isSfc = !!a.wrapSfcScript || !!a.sfc;
        if (!isSfc) return [];
        const matchFn = a.match;
        if (!matchFn) return [];
        return this.extensions.filter((ext) => matchFn("dummy" + ext));
      })
      .flat();
    const keepExts = [".html", ".tsx", ".jsx", ...sfcExts];
    const stripExts = this.extensions.filter(
      (ext) => !keepExts.some((k) => k.toLowerCase() === ext.toLowerCase()),
    );

    const escapedStripExts = stripExts
      .map((e) => (e.startsWith(".") ? e.slice(1) : e))
      .map((e) => e.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    const hasSourceExtension = new RegExp(`\\.(?:${escapedStripExts.join("|")})$`, "i").test(rel);
    const result = hasSourceExtension ? rel.replace(/\.[^/.]+$/, "") : rel;
    this.normalizedIdCache.set(id, result);
    return result;
  }

  private formatJson(json: string): string {
    let formatted = json.replace(/\[\n\s*([^\]]*?)\n\s*\]/g, (match) => {
      try {
        const parsed = JSON.parse(match);
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item !== "object" && item !== null)
        ) {
          const collapsed = JSON.stringify(parsed);
          // Format with spaces after commas to match Prettier formatting: ["a", "b"]
          const spaced = collapsed.replace(/,/g, ", ");
          if (spaced.length < 80) {
            return spaced;
          }
        }
      } catch {}
      return match;
    });
    if (!formatted.endsWith("\n")) {
      formatted += "\n";
    }
    return formatted;
  }

  /**
   * Record the fate of one artifact write or removal.
   *
   * Every path through `safeWriteFile` — written, skipped as identical, failed —
   * reaches a terminal outcome (Axiom D2), so an output that exists on disk can
   * be traced to the write that put it there, and one that does not can be
   * traced to the write that never happened.
   */
  private settleWrite(path: string, outcome: "applied" | "superseded" | "failed", reason?: string) {
    if (!this.bus) return;
    this.bus.settle(this.bus.mint("io/write", this.getNormalizedId(path)), outcome, reason);
  }

  /**
   * @param cause Why this write was scheduled, when the caller knows.
   *
   * Ledger L-071 spent four attempts on a file that kept coming back after the
   * prune correctly deleted it, and every one of them guessed at the writer.
   * The interleaved log that finally named the first one existed only because
   * `Writing file:` and `Pruning orphaned file:` happen to share a logger — it
   * could say *that* a file was written and never *why*. A flush has five
   * independent reasons to write a catalog and they are indistinguishable on
   * the wire, which is what made the second writer a matter of inference.
   *
   * Carried through to the `io/write` envelope as well as the log, so the
   * reason survives wherever the delivery ledger is read.
   */
  public async safeWriteFile(path: string | null, content: string, cause?: string) {
    if (!path) return;
    let finalContent = content;
    if (path.endsWith(".json")) {
      finalContent = this.formatJson(content);
    }

    try {
      if (await this.exists(path)) {
        const existing = await this.readFile(path);
        if (existing.trim().replace(/\r\n/g, "\n") === finalContent.trim().replace(/\r\n/g, "\n")) {
          // Not a no-op worth hiding: an artifact that is already correct is a
          // delivery that landed, and saying nothing makes it indistinguishable
          // from one that never ran.
          this.settleWrite(
            path,
            "superseded",
            cause ? `content already identical (${cause})` : "content already identical",
          );
          return;
        }
      }
    } catch {
      // Ignore read errors and proceed to write
    }

    this.logger.debug(`Writing file: ${relative(this.root, path)}${cause ? ` — ${cause}` : ""}`);
    this.writingFiles.add(path);
    try {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, finalContent, "utf-8");
      this.rememberWrite(path, finalContent);
      await this.formatFile(path);
      /**
       * Re-read rather than assume. The formatter is an external process that
       * rewrites the file, so what is on disk once it has run is a third string
       * neither the caller nor this method composed — and it is the one the
       * watcher will hand back.
       */
      this.rememberWrite(path, finalContent, await this.readFile(path).catch(() => finalContent));
      this.settleWrite(path, "applied", cause);
    } catch (err) {
      this.settleWrite(path, "failed", String(err));
      throw err;
    } finally {
      /**
       * Each write closes its **own** window, not whichever one is open.
       *
       * This used to be a bare `delete`, so for a path written more than once an
       * early write's timer shut the guard on a later write that was still in
       * flight. Measured on one passing `syntax-recovery` run: echoes arriving
       * with the guard already closed at 118–209 ms against a nominal 500, on a
       * catalog rewritten four times in that run.
       *
       * That mattered more before content identity, but it still does: the
       * window's remaining job is to cover the instant *inside* `writeFile`, and
       * a guard another write can close is not covering it.
       */
      const token = ++this.writeTicket;
      this.writeTickets.set(path, token);
      setTimeout(() => {
        if (this.writeTickets.get(path) !== token) return;
        this.writeTickets.delete(path);
        this.writingFiles.delete(path);
      }, WRITE_GUARD_DELAY_MS);
    }
  }

  /** Monotonic id per write, so a guard is only closed by the write that opened it. */
  private writeTicket = 0;
  private readonly writeTickets = new Map<string, number>();

  /**
   * Content reduced to what a comparison should care about.
   *
   * The same normalisation {@link safeWriteFile} already uses to decide a write
   * would be a no-op: trailing whitespace and line endings differ between what
   * we write, what a formatter leaves, and what a watcher hands back.
   */
  private static signature(content: string): string {
    return sha1(content.trim().replace(/\r\n/g, "\n"));
  }

  /** Replace what is remembered for a path with the states this write left. */
  private rememberWrite(path: string, ...contents: string[]) {
    this.knownContent.set(path, new Set(contents.map((c) => IOManager.signature(c))));
  }

  /**
   * Does this path already hold the content the compiler has?
   *
   * Asked of the file's **current** contents, not of a clock. `content` is the
   * text the host already read for this event where it has one; everything else
   * is re-read here, because "what is on disk now" is the only question whose
   * answer stays true however late the event arrived.
   *
   * {@link writingFiles} is still consulted first — it is cheaper, and it covers
   * the instant between `writeFile` and the formatter when the bytes on disk are
   * neither state cleanly.
   */
  public async isUnchangedContent(path: string, content?: string): Promise<boolean> {
    if (this.writingFiles.has(path)) return true;
    const known = this.knownContent.get(path);
    if (!known || known.size === 0) return false;

    let text = content;
    if (text === undefined) {
      try {
        text = await this.readFile(path);
      } catch {
        /**
         * Gone, or being replaced this instant. Neither is an echo this can
         * confirm, and a deletion is a real event the caller still has to see.
         */
        return false;
      }
    }
    return known.has(IOManager.signature(text));
  }

  /**
   * Stop treating a path's last written content as ours.
   *
   * Called once an event for that path has been accepted as a genuine change.
   * Without it, a hand-edit that happened to restore exactly what the compiler
   * last wrote would read as an echo for the life of the process — the one way
   * content identity could be *stickier* than the window it replaces.
   */
  public forgetWrite(path: string) {
    this.knownContent.delete(path);
  }

  public async formatFile(path: string) {
    if (!this.isDev || !this.detectedFormatter) return;
    const args = this.detectedFormatter.args.map((a) => a.replace("[path]", path));
    this.logger.debug(`Formatting file: ${relative(this.root, path)}`);
    return new Promise<void>((resolve) => {
      const proc = spawn(this.detectedFormatter!.bin, args, { stdio: "ignore" });
      if (proc.on) {
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
      } else {
        resolve();
      }
    });
  }

  public async readFile(path: string): Promise<string> {
    this.logger.debug(`Reading file: ${relative(this.root, path)}`);
    const raw = await readFile(path, "utf-8");
    const content = raw.replace(/\r\n/g, "\n");

    /**
     * The first read of a path establishes what the compiler believes is there.
     *
     * Only the first: after that, a write is the only thing allowed to move the
     * baseline. Reading again must not, or a hand-edited catalog the compiler
     * happens to re-read before the watcher event arrives would have that event
     * dismissed as "nothing changed" — and the edit would never reach the page.
     *
     * With that restriction the rule suppresses exactly one thing: an event for
     * a file that still holds the content the compiler started from. Which is
     * the case that reloads the browser for nothing — see {@link knownContent}.
     */
    if (!this.knownContent.has(path)) {
      this.knownContent.set(path, new Set([IOManager.signature(content)]));
    }
    return content;
  }

  public async readBuffer(path: string): Promise<Buffer> {
    this.logger.debug(`Reading file as buffer: ${relative(this.root, path)}`);
    return readFile(path);
  }

  public async safeWriteBuffer(path: string | null, content: Buffer) {
    if (!path) return;

    try {
      if (await this.exists(path)) {
        const existing = await this.readBuffer(path);
        if (existing.equals(content)) {
          return;
        }
      }
    } catch {
      // Ignore read errors and proceed to write
    }

    this.logger.debug(`Writing file as buffer: ${relative(this.root, path)}`);
    this.writingFiles.add(path);
    try {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, content);
    } finally {
      setTimeout(() => {
        this.writingFiles.delete(path);
      }, WRITE_GUARD_DELAY_MS);
    }
  }

  public async readDir(path: string): Promise<string[]> {
    return readdir(path);
  }

  public async readEntries(path: string) {
    return readdir(path, { withFileTypes: true });
  }

  public async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  public async rm(path: string) {
    // Reclaiming an artifact is a delivery too. An output that vanished and one
    // that was never written look identical on disk; only the ledger separates
    // them, which is the whole of "artifacts outliving their source" in reverse.
    try {
      await rm(path, { recursive: true, force: true });
      // Nothing of ours is on disk here any more, so nothing of ours is worth
      // recognising: a file that reappears at this path came from elsewhere.
      this.forgetWrite(path);
      this.settleWrite(path, "applied", "reclaimed");
    } catch (err) {
      this.settleWrite(path, "failed", `could not reclaim: ${String(err)}`);
      throw err;
    }
  }

  public async stat(path: string) {
    return stat(path);
  }
}
