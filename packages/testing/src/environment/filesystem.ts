import { readFile, writeFile, unlink, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type FsMutation =
  | { type: "edit"; path: string; original: string }
  | { type: "write"; path: string; existed: boolean; original?: string }
  | { type: "delete"; path: string; original: string }
  | { type: "rename"; from: string; to: string };

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

    await this.runBeforeMutation();
    await writeFile(fullPath, updated, "utf-8");

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

    await this.runBeforeMutation();
    await writeFile(fullPath, content, "utf-8");

    if (this.onMutationCallback) {
      await this.onMutationCallback();
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    if (!existsSync(fullPath)) return;

    const original = await readFile(fullPath, "utf-8");
    this._mutations.push({ type: "delete", path: relativePath, original });

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

    await rename(fromFullPath, toFullPath);
  }

  async read(relativePath: string): Promise<string> {
    const fullPath = this.resolvePath(relativePath);
    return await readFile(fullPath, "utf-8");
  }

  async restoreAll(): Promise<void> {
    // 1. Restore tracked mutations
    for (let i = this._mutations.length - 1; i >= 0; i--) {
      const m = this._mutations[i];
      try {
        if (m.type === "edit") {
          const fullPath = this.resolvePath(m.path);
          await writeFile(fullPath, m.original, "utf-8");
        } else if (m.type === "write") {
          const fullPath = this.resolvePath(m.path);
          if (m.existed && m.original !== undefined) {
            await writeFile(fullPath, m.original, "utf-8");
          } else {
            if (existsSync(fullPath)) {
              await unlink(fullPath);
            }
          }
        } else if (m.type === "delete") {
          const fullPath = this.resolvePath(m.path);
          await writeFile(fullPath, m.original, "utf-8");
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

    this._mutations = [];

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
