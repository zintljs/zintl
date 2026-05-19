import { describe, bench, afterAll } from "vite-plus/test";
import { ZintlCompiler } from "../index.js";
import { extract } from "@zintl/extractor";
import { generateStressProject } from "./stress-util.js";
import { rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Zintl Compiler Pipeline", async () => {
  const root = join(tmpdir(), `zintl-bench-stable-${Date.now()}`);

  const generatedFiles = await generateStressProject(root, {
    numFiles: 20,
    depsPerFile: 2,
    stringsPerFile: 5,
  });

  const compiler = new ZintlCompiler(
    {
      sourceLocale: "en",
      locales: ["en", "ar"],
      outputDir: "locales",
      catalogFormat: "i18n.json", // Testing the new multilingual default
      logLevel: "silent",
    },
    root,
    true,
  );

  const fileContents = await Promise.all(
    generatedFiles.map((f) =>
      readFile(join(root, f.path), "utf-8").then((c) => ({
        path: join(root, f.path),
        rel: f.path,
        content: c,
      })),
    ),
  );

  // Warm up
  const mainEntry = fileContents.find((f) => f.rel === "src/main.ts")!;
  await compiler.transform(mainEntry.content, mainEntry.path, "none");
  for (const f of fileContents) {
    await compiler.transform(f.content, f.path, "none");
  }

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  bench(
    "Reference Calibration (No-Op)",
    () => {
      extract("", "x.js", "x");
    },
    { time: 500 },
  );

  bench(
    "Extractor Baseline (Full Project)",
    () => {
      for (const file of fileContents) {
        extract(file.content, file.path, file.rel.replace(/\.[^/.]+$/, ""));
      }
    },
    { time: 500 },
  );

  bench(
    "Hot HMR Latency (Warm Path)",
    async () => {
      const testFile = fileContents[1];
      await compiler.transform(testFile.content, testFile.path, "none");
    },
    { time: 2000, iterations: 100 },
  );

  bench(
    "Structural HMR Latency (Patch Path)",
    async () => {
      const testFile = fileContents[5];
      const newContent =
        testFile.content +
        `\n// touch ${Math.random()}\nimport { util_0 } from "../lib/util_0.js";\n`;
      await compiler.transform(newContent, testFile.path, "none");
    },
    { time: 2000, iterations: 100 },
  );

  bench(
    "Catalog Serialization Logic",
    async () => {
      await compiler.flush();
    },
    { time: 1000, iterations: 100 },
  );

  // Setup for Colony HMR Bench
  const colonyPath = join(root, "src/colony.ts");
  const colonyContent = (seed: number) => `
    import { t } from "zintl/macro";
    export function Colony() { return t("Colony Message ${seed}"); }
  `;
  await writeFile(colonyPath, colonyContent(0));
  // const colonyRel = "src/colony.ts";

  const kingdomPath = join(root, "src/kingdom.ts");
  const kingdomContent = `
    import { zintl } from "zintl/macro";
    zintl("en");
    export async function main() {
      const { Colony } = await import("./colony.js");
      return Colony();
    }
  `;
  await writeFile(kingdomPath, kingdomContent);
  const kingdomRel = "src/kingdom.ts";

  // Initial scan
  await compiler.transform(colonyContent(0), colonyPath, "none");
  await compiler.transform(kingdomContent, kingdomPath, "none");
  await (compiler as any).syncGraphs();

  bench(
    "Colony HMR Latency (Manager Sync)",
    async () => {
      // 1. User updates Colony
      const newColonyContent = colonyContent(Math.random());
      await writeFile(colonyPath, newColonyContent);

      // 2. System detects change
      await compiler.invalidateFile(colonyPath);

      // 3. User (Vite) re-requests the Manager
      const safeId = compiler.getSafeBoundaryId(kingdomRel.replace(".ts", ""));
      const mod = await compiler.generateVirtualModule(`entry:${safeId}`, "en", true);

      // 4. Verify the update reached the manager
      if (!mod.code.includes("Colony Message")) {
        throw new Error("HMR failed: Manager did not reflect colony change");
      }
    },
    { time: 2000, iterations: 100 },
  );
});
