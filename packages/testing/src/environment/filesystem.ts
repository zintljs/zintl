import { readFile, writeFile, unlink, rename, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";

export type FsMutation =
  | { type: "edit"; path: string; original: string }
  | { type: "write"; path: string; existed: boolean; original?: string }
  | { type: "delete"; path: string; original: string }
  | { type: "rename"; from: string; to: string };

/**
 * Timestamped trace of what the harness itself does to the project's files.
 *
 * Off unless `ZINTL_FS_TRACE` is set. It exists because the compiler's debug log
 * and the harness's mutations were two streams nobody had read *in order* —
 * which is exactly what named L-071's first writer, one layer down, and what
 * this file's own operations had no way of contributing to.
 */
function fsTrace(op: string, path: string, extra = ""): void {
  if (!process.env.ZINTL_FS_TRACE) return;
  console.debug(`  lab:fs ${new Date().toISOString().slice(11, 23)} ${op} ${path} ${extra}`);
}

export class LabFilesystem {
  private exampleRoot: string;
  private _mutations: FsMutation[] = [];
  private onMutationCallback?: () => Promise<void>;
  private beforeMutationCallback?: () => Promise<void>;
  private catalogBackups = new Map<string, string>();

  constructor(exampleRoot: string, onMutation?: () => Promise<void>) {
    this.exampleRoot = exampleRoot;
    this.onMutationCallback = onMutation;
  }

  setMutationCallback(onMutation: () => Promise<void>) {
    this.onMutationCallback = onMutation;
  }

  /**
   * Runs immediately before a mutation touches disk.
   *
   * Exists so a caller can record the runtime's settle counter *before* the
   * change it is about to cause. Reading it afterwards would race the very
   * update being waited on.
   */
  setBeforeMutationCallback(beforeMutation: () => Promise<void>) {
    this.beforeMutationCallback = beforeMutation;
  }

  private async runBeforeMutation(): Promise<void> {
    if (this.beforeMutationCallback) {
      await this.beforeMutationCallback();
    }
  }

  private async findJsonFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    let entries: any[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".vite" ||
          entry.name === "dist" ||
          entry.name === ".next" ||
          entry.name === ".git"
        ) {
          continue;
        }
        results.push(...(await this.findJsonFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        if (entry.name !== "package.json" && entry.name !== "tsconfig.json") {
          results.push(fullPath);
        }
      }
    }
    return results;
  }

  async init(): Promise<void> {
    const jsonFiles = await this.findJsonFiles(this.exampleRoot);
    for (const file of jsonFiles) {
      try {
        const content = await readFile(file, "utf-8");
        this.catalogBackups.set(file, content);
      } catch {
        // Ignore read errors
      }
    }
  }

  get mutations(): ReadonlyArray<FsMutation> {
    return this._mutations;
  }

  private resolvePath(relativePath: string): string {
    return join(this.exampleRoot, relativePath);
  }

  /**
   * Replace a file the way an editor does: write a temp file, then `rename`.
   *
   * `writeFile` truncates and then writes, so a watcher can observe the file
   * **empty** before it observes the new content — one logical edit arriving as
   * two events. Every editor a real user runs avoids this with an atomic rename;
   * the harness was the only thing producing the intermediate state.
   *
   * It matters more than it sounds. Rspack's dev watcher runs with
   * `aggregateTimeout: 0`, and an empty entry module compiles *successfully* —
   * so the truncation window can produce a real, successful build of an empty
   * app between the two halves of a single edit. That both doubles the chance of
   * an update landing while the HMR runtime is not idle (where Rsbuild's client
   * drops it silently and never retries) and can change the entrypoint chunk
   * set, which makes the dev server emit a bare `full-reload` instead of the
   * `hash`/`ok` pair the client needs.
   *
   * The temp file is a dotfile with no source extension, deliberately: it lands
   * in the watched tree for an instant, and it must not look like a module to
   * anything that might try to compile it.
   */
  private async atomicWrite(fullPath: string, content: string): Promise<void> {
    const tmp = join(dirname(fullPath), `.${basename(fullPath)}.zintl-tmp`);
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, fullPath);
  }

  /**
   * Replace a file atomically and return **without waiting for propagation**.
   *
   * For contracts that deliberately outrun the dev server, where `edit()`'s
   * settle wait would defeat the point. The alternative in use was a bare
   * `writeFile`, which truncates before writing — so a burst mixed truncating
   * writes with an atomic rename, and chokidar's atomic-save detection
   * (`unlink` then `add` on one path inside ~100 ms) could collapse the two
   * into one event. Ledger L-080 caught it losing a burst's **final** write, at
   * which point no software downstream can converge.
   *
   * "Outrun the propagation wait" and "truncate the file" are different things,
   * and only the first was ever wanted. Every editor a real user runs saves
   * atomically.
   */
  async writeUnsynchronized(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const existed = existsSync(fullPath);
    const original = existed ? await readFile(fullPath, "utf-8") : undefined;

    const alreadyMutated = this._mutations.some(
      (m) => (m.type === "edit" || m.type === "write") && m.path === relativePath,
    );
    if (!alreadyMutated) {
      this._mutations.push({ type: "write", path: relativePath, existed, original });
    }

    fsTrace("write-unsync", relativePath);
    await this.atomicWrite(fullPath, content);
  }

  async edit(relativePath: string, transform: (content: string) => string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    if (!existsSync(fullPath)) {
      throw new Error(`File to edit does not exist: ${relativePath}`);
    }
    const original = await readFile(fullPath, "utf-8");
    const updated = transform(original);

    const alreadyMutated = this._mutations.some(
      (m) => (m.type === "edit" || m.type === "write") && m.path === relativePath,
    );
    if (!alreadyMutated) {
      this._mutations.push({ type: "edit", path: relativePath, original });
    }

    fsTrace("edit", relativePath);
    await this.runBeforeMutation();
    await this.atomicWrite(fullPath, updated);

    if (this.onMutationCallback) {
      await this.onMutationCallback();
    }
  }

  async write(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const existed = existsSync(fullPath);
    let original: string | undefined;

    if (existed) {
      original = await readFile(fullPath, "utf-8");
    }

    const alreadyMutated = this._mutations.some(
      (m) => (m.type === "edit" || m.type === "write") && m.path === relativePath,
    );
    if (!alreadyMutated) {
      this._mutations.push({ type: "write", path: relativePath, existed, original });
    }

    fsTrace("write", relativePath);
    await this.runBeforeMutation();
    await this.atomicWrite(fullPath, content);

    if (this.onMutationCallback) {
      await this.onMutationCallback();
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    if (!existsSync(fullPath)) return;

    const original = await readFile(fullPath, "utf-8");
    this._mutations.push({ type: "delete", path: relativePath, original });

    fsTrace("delete", relativePath);
    await this.runBeforeMutation();
    await unlink(fullPath);

    if (this.onMutationCallback) {
      await this.onMutationCallback();
    }
  }

  async rename(fromRelative: string, toRelative: string): Promise<void> {
    const fromFullPath = this.resolvePath(fromRelative);
    const toFullPath = this.resolvePath(toRelative);

    this._mutations.push({ type: "rename", from: fromRelative, to: toRelative });

    /**
     * A rename is a mutation like any other, and this was the only one that
     * fired neither hook — so no settle baseline was taken and nothing waited
     * for the result. A contract renaming a file then asserting on the DOM was
     * racing the dev server with no synchronisation at all.
     */
    await this.runBeforeMutation();
    await rename(fromFullPath, toFullPath);

    if (this.onMutationCallback) {
      await this.onMutationCallback();
    }
  }

  async read(relativePath: string): Promise<string> {
    const fullPath = this.resolvePath(relativePath);
    return await readFile(fullPath, "utf-8");
  }

  async restoreAll(): Promise<void> {
    // 1. Restore tracked mutations
    for (let i = this._mutations.length - 1; i >= 0; i--) {
      const m = this._mutations[i];
      fsTrace("restore", "path" in m ? m.path : `${m.from} → ${m.to}`, `(${m.type})`);
      try {
        if (m.type === "edit") {
          const fullPath = this.resolvePath(m.path);
          await this.atomicWrite(fullPath, m.original);
        } else if (m.type === "write") {
          const fullPath = this.resolvePath(m.path);
          if (m.existed && m.original !== undefined) {
            await this.atomicWrite(fullPath, m.original);
          } else {
            if (existsSync(fullPath)) {
              await unlink(fullPath);
            }
          }
        } else if (m.type === "delete") {
          const fullPath = this.resolvePath(m.path);
          await this.atomicWrite(fullPath, m.original);
        } else if (m.type === "rename") {
          const fromFullPath = this.resolvePath(m.from);
          const toFullPath = this.resolvePath(m.to);
          if (existsSync(toFullPath)) {
            await rename(toFullPath, fromFullPath);
          }
        }
      } catch (err) {
        console.error(`[FS Restore Error] Failed to restore mutation:`, m, err);
      }
    }

    const restored = this._mutations.length > 0;
    this._mutations = [];

    /**
     * Let the rebuild these restores caused actually finish.
     *
     * The dev server is pooled per project per worker, so it outlives the lab
     * that made these edits: whatever this restore just triggered is still
     * compiling when the *next* contract navigates and takes its settle
     * baseline. That contract then measures a page mid-rebuild and attributes
     * the result to its own edit.
     *
     * The hook was already wired and commented out at the bottom of this method.
     * It is called here instead — right after the source files are back and
     * before the catalog work below — because the source restore is the part
     * that triggers a compilation.
     */
    if (restored && this.onMutationCallback) {
      await this.onMutationCallback();
    }

    // 2. Restore JSON translation catalogs to their original/pristine states
    // const currentJsonFiles = await this.findJsonFiles(this.exampleRoot);

    // for (const file of currentJsonFiles) {
    //   if (this.catalogBackups.has(file)) {
    //     const originalContent = this.catalogBackups.get(file)!;
    //     const currentContent = await readFile(file, "utf-8").catch(() => "");
    //     if (currentContent !== originalContent) {
    //       await writeFile(file, originalContent, "utf-8");
    //     }
    //   } else {
    //     // File was created during the test, clean it up
    //     await unlink(file).catch(() => {
    //       console.log("FILE: ", file, " could not be deleted");
    //     });
    //   }
    // }

    // 3. Recreate any JSON files that were deleted during the test
    // for (const [file, originalContent] of this.catalogBackups.entries()) {
    //   if (!existsSync(file)) {
    //     await mkdir(dirname(file), { recursive: true });
    //     await writeFile(file, originalContent, "utf-8");
    //   }
    // }

    // 4. Clean up compiler metadata directory in node_modules/.zintl to clear boundary graph cache
    // const metadataDir = join(this.exampleRoot, "node_modules", ".zintl");
    // if (existsSync(metadataDir)) {
    //   await rm(metadataDir, { recursive: true, force: true }).catch(() => {});
    // }

    // if (this.onMutationCallback) {
    //   await this.onMutationCallback();
    // }
  }
}
