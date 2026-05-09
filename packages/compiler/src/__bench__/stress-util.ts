import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Generates a synthetic project for benchmarking Zintl.
 */
export async function generateStressProject(
  root: string,
  options: {
    numFiles?: number;
    depsPerFile?: number;
    stringsPerFile?: number;
  } = {},
) {
  const { numFiles = 1000, depsPerFile = 3, stringsPerFile = 5 } = options;

  await mkdir(join(root, "src/components"), { recursive: true });
  await mkdir(join(root, "src/lib"), { recursive: true });

  const files = [];

  // 1. Generate Libs
  const numLibs = Math.floor(numFiles * 0.2);
  for (let i = 0; i < numLibs; i++) {
    const path = `src/lib/util_${i}.ts`;
    const content = `
      export function util_${i}(val: any) {
        return val + "_processed";
      }
      export const LABEL_${i} = "Util Label ${i}";
    `;
    files.push({ path, content });
  }

  // 2. Generate Components
  const numCmps = numFiles - numLibs - 2;
  for (let i = 0; i < numCmps; i++) {
    const path = `src/components/cmp_${i}.ts`;

    // Dependencies
    const libs = [];
    for (let j = 0; j < depsPerFile; j++) {
      libs.push(`util_${Math.floor(Math.random() * numLibs)}`);
    }
    const imports = [...new Set(libs)]
      .map((lib) => `import { ${lib} } from "../lib/${lib}.js";`)
      .join("\n");

    let strings = "";
    for (let j = 0; j < stringsPerFile; j++) {
      strings += `export const MSG_${i}_${j} = \`Message \${Math.random()} for ${i} and ${j}\`;\n`;
    }

    const content = `
      /* @zintl-note "Benchmark Component ${i}" */
      import { t } from "zintl";
      ${imports}
      
      export function render_${i}() {
        // Force the compiler to see this as a translatable unit
        return t("Rendered component ${i}");
      }
    `;
    files.push({ path, content });
  }

  // 3. Main Entry
  const mainImports = [];
  for (let i = 0; i < Math.min(numCmps, 50); i++) {
    mainImports.push(`import { render_${i} } from "./components/cmp_${i}.js";`);
  }

  const mainContent = `
    import { zintl } from "zintl";
    ${mainImports.join("\n")}
    
    zintl("en");
    
    export function main() {
      ${mainImports.map((_, i) => `render_${i}();`).join("\n      ")}
    }
  `;
  files.push({ path: "src/main.ts", content: mainContent });

  // 4. Secondary Entry (Multi-entry test)
  const secondaryContent = `
    import { zintl } from "zintl";
    import { render_0 } from "./components/cmp_0.js";
    zintl("ar");
    render_0();
  `;
  files.push({ path: "src/secondary.ts", content: secondaryContent });

  for (const file of files) {
    const fullPath = join(root, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content);
  }

  return files;
}
