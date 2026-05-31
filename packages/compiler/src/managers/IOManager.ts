import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, rm, stat, readdir } from "node:fs/promises";
import { join, dirname, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { calculateBoundaryId, calculateSafeBoundaryId } from "../utils/hashing.js";
import {
  COMPILER_METADATA_DIR,
  MANIFEST_FILENAME,
  HIVE_FILENAME,
  WRITE_GUARD_DELAY_MS,
} from "../constants.js";
import type { ZintlOptions, ZintlLogger } from "../types/index.js";

/**
 * Handles all I/O operations, formatting, and hashing.
 */
export class IOManager {
  public readonly manifestPath: string;
  public readonly hivePath: string;
  public readonly writingFiles = new Set<string>();
  private detectedFormatter: { bin: string; args: string[] } | null = null;
  private readonly boundaryIdCache = new Map<string, string>();
  private readonly normalizedIdCache = new Map<string, string>();

  constructor(
    private readonly root: string,
    private readonly isDev: boolean,
    private readonly logger: ZintlLogger,
    _options: ZintlOptions,
  ) {
    const metaDir = _options.metadataDir
      ? isAbsolute(_options.metadataDir)
        ? _options.metadataDir
        : join(root, _options.metadataDir)
      : join(root, "node_modules", COMPILER_METADATA_DIR);

    this.manifestPath = join(metaDir, MANIFEST_FILENAME);
    this.hivePath = join(metaDir, HIVE_FILENAME);
    this.detectFormatter();
  }

  public setMetadataDir(dir?: string) {
    const metaDir = dir
      ? isAbsolute(dir)
        ? dir
        : join(this.root, dir)
      : join(this.root, "node_modules", COMPILER_METADATA_DIR);

    (this as any).manifestPath = join(metaDir, MANIFEST_FILENAME);
    (this as any).hivePath = join(metaDir, HIVE_FILENAME);
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

  public getNormalizedId(id: string) {
    if (this.normalizedIdCache.has(id)) return this.normalizedIdCache.get(id)!;
    if (id.startsWith("\0")) return id;

    const targetId = id.replace(/\.zintl-[a-zA-Z0-9_-]+\.(vue|svelte)/, ".$1");

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

    const rel = relative(this.root, abs).replace(/\\/g, "/");
    const hasSourceExtension = /\.(tsx?|jsx?|mts|mjs|cts|cjs)$/i.test(rel);
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

  public async safeWriteFile(path: string | null, content: string) {
    if (!path) return;

    let finalContent = content;
    if (path.endsWith(".json")) {
      finalContent = this.formatJson(content);
    }

    try {
      if (await this.exists(path)) {
        const existing = await this.readFile(path);
        if (existing.trim().replace(/\r\n/g, "\n") === finalContent.trim().replace(/\r\n/g, "\n")) {
          return;
        }
      }
    } catch {
      // Ignore read errors and proceed to write
    }

    this.logger.debug(`Writing file: ${relative(this.root, path)}`);
    this.writingFiles.add(path);
    try {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, finalContent, "utf-8");
      await this.formatFile(path);
    } finally {
      setTimeout(() => {
        this.writingFiles.delete(path);
      }, WRITE_GUARD_DELAY_MS);
    }
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
    const content = await readFile(path, "utf-8");
    return content.replace(/\r\n/g, "\n");
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
    await rm(path, { recursive: true, force: true });
  }

  public async stat(path: string) {
    return stat(path);
  }
}
