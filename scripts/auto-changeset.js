import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Reads a file from git HEAD to compare changes.
 */
function getFileFromGit(filePath) {
  try {
    return execSync(`git show HEAD:${filePath}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Parses pnpm-workspace.yaml's catalog section.
 */
function parseCatalog(content) {
  if (!content) return {};
  const lines = content.split("\n");
  const catalog = {};
  let insideCatalog = false;

  for (const line of lines) {
    if (line.trim() === "catalog:") {
      insideCatalog = true;
      continue;
    }
    if (insideCatalog) {
      // If we encounter a non-empty line that doesn't start with space, comment, or dash, the catalog block has ended.
      if (
        line.trim() &&
        !line.startsWith(" ") &&
        !line.startsWith("-") &&
        !line.trim().startsWith("#")
      ) {
        insideCatalog = false;
        continue;
      }
      const match = line.match(/^\s+["']?([^"'\s:]+)["']?\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/);
      if (match) {
        catalog[match[1]] = match[2];
      }
    }
  }
  return catalog;
}

function run() {
  const packagesRoot = path.join(process.cwd(), "packages");
  const packagesDirs = fs.readdirSync(packagesRoot).filter((dir) => {
    return (
      fs.statSync(path.join(packagesRoot, dir)).isDirectory() &&
      fs.existsSync(path.join(packagesRoot, dir, "package.json"))
    );
  });

  // 1. Detect updates in the global pnpm catalog
  const currentCatalogContent = fs.readFileSync(
    path.join(process.cwd(), "pnpm-workspace.yaml"),
    "utf8",
  );
  const headCatalogContent = getFileFromGit("pnpm-workspace.yaml");

  const currentCatalog = parseCatalog(currentCatalogContent);
  const headCatalog = parseCatalog(headCatalogContent);

  const updatedCatalogDeps = {};
  for (const [name, version] of Object.entries(currentCatalog)) {
    if (headCatalog[name] !== version) {
      updatedCatalogDeps[name] = version;
    }
  }

  // 2. Scan workspace packages to see if they are affected by catalog changes or direct dependency changes
  const updatedWorkspacePackages = new Map(); // package_name -> Set of updated dependency strings

  for (const dir of packagesDirs) {
    const pkgPath = path.join(packagesRoot, dir, "package.json");
    const pkgContent = fs.readFileSync(pkgPath, "utf8");
    const pkgJson = JSON.parse(pkgContent);
    const pkgName = pkgJson.name;

    const headPkgContent = getFileFromGit(`packages/${dir}/package.json`);
    const headPkgJson = headPkgContent ? JSON.parse(headPkgContent) : null;

    const changedDeps = [];

    const checkDepGroup = (groupName) => {
      const deps = pkgJson[groupName] || {};
      const headDeps = headPkgJson ? headPkgJson[groupName] || {} : {};

      for (const [depName, depVer] of Object.entries(deps)) {
        // Ignore internal monorepo packages (handled by changeset version natively)
        if (depName === "zintl" || depName.startsWith("@zintl/")) {
          continue;
        }

        let isUpdated = false;
        let newVersionStr = "";

        if (depVer === "catalog:") {
          // Uses global catalog
          if (updatedCatalogDeps[depName]) {
            isUpdated = true;
            newVersionStr = updatedCatalogDeps[depName];
          }
        } else {
          // Direct dependency
          const headDepVer = headDeps[depName];
          if (headDepVer && headDepVer !== depVer) {
            isUpdated = true;
            newVersionStr = depVer;
          }
        }

        if (isUpdated) {
          // Clean up version string if it uses npm: alias syntax
          let cleanVer = newVersionStr;
          if (cleanVer.startsWith("npm:")) {
            const parts = cleanVer.split("@");
            cleanVer = parts[parts.length - 1];
          }
          changedDeps.push(`${depName}@${cleanVer}`);
        }
      }
    };

    checkDepGroup("dependencies");
    checkDepGroup("devDependencies");

    if (changedDeps.length > 0) {
      updatedWorkspacePackages.set(pkgName, changedDeps);
    }
  }

  // 3. Write changeset files if modifications are found (one per package)
  if (updatedWorkspacePackages.size > 0) {
    const changesetDir = path.join(process.cwd(), ".changeset");
    if (!fs.existsSync(changesetDir)) {
      fs.mkdirSync(changesetDir, { recursive: true });
    }

    for (const [pkgName, changes] of updatedWorkspacePackages.entries()) {
      let frontmatter = "---\n";
      frontmatter += `"${pkgName}": patch\n`;
      frontmatter += "---\n\n";

      let body = "Updated external dependencies:\n";
      for (const change of Array.from(new Set(changes)).sort((a, b) => a.localeCompare(b))) {
        // oxlint-disable-next-line typescript/restrict-template-expressions
        body += `- ${change}\n`;
      }

      const changesetContent = frontmatter + body;

      // Make a clean filename using the package folder/name
      const cleanPkgName = pkgName.replace(/^@/, "").replace(/\//g, "-");
      const hash = Math.random().toString(36).substring(2, 10);
      const changesetFileName = `zzzz-auto-deps-${cleanPkgName}-${hash}.md`;
      const changesetPath = path.join(changesetDir, changesetFileName);

      fs.writeFileSync(changesetPath, changesetContent);

      console.log(`\n✅ Generated changeset at .changeset/${changesetFileName}:`);
      console.log("--------------------------------------------------");
      console.log(changesetContent);
      console.log("--------------------------------------------------");
    }
  } else {
    console.log("No external dependency changes detected compared to HEAD.");
  }
}

run();
