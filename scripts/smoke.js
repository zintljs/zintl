import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Outside-in publish smoke test.
 *
 * Packs the real tarballs, installs them into a throwaway app OUTSIDE this
 * workspace, and builds against stock Vite. The point is to use as little of
 * this repo's machinery as possible — every piece of our own tooling it touches
 * is a piece it can no longer validate.
 *
 * Deliberate choices:
 *  - `pnpm pack`, not `npm pack`: only pnpm rewrites `catalog:`/`workspace:*`
 *    into real semver. `npm pack` ships them verbatim and every npm/yarn user
 *    then fails with EUNSUPPORTEDPROTOCOL.
 *  - `npm install` in the fixture, not pnpm: npm is the strictest about those
 *    protocols and is what most consumers actually run.
 *  - the fixture lives in the OS temp dir: inside the workspace, pnpm would
 *    link the real packages and mask exactly the bugs we are hunting.
 *
 * Every published entry point needs a run here, not just the popular one. A
 * consumer's `npm install` resolves `unplugin`, `@rsbuild/core` and the `./rsbuild`
 * export through none of the machinery a pnpm workspace provides, and ledger L-004's
 * own subject — unplugin materialising virtual modules under `node_modules/.virtual/`
 * — is exactly the kind of behaviour that can differ between the two.
 *
 * Usage:
 *   node scripts/smoke.js                 # Vite matrix, then Rsbuild
 *   node scripts/smoke.js --vite=8        # single Vite version, then Rsbuild
 *   node scripts/smoke.js --vite=none     # Rsbuild only
 *   node scripts/smoke.js --no-rsbuild    # Vite only
 *   node scripts/smoke.js --keep          # leave the fixture for inspection
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MATRIX = ["6", "7", "8"];

/** Matches the `@rsbuild/core` range `zintljs` declares as an optional peer. */
const RSBUILD_RANGE = "^2.1.0";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const withRsbuild = !args.includes("--no-rsbuild");
const viteArg = args.find((a) => a.startsWith("--vite="));
const requestedMatrix = viteArg ? viteArg.slice("--vite=".length).split(",") : DEFAULT_MATRIX;
const matrix = requestedMatrix.filter((v) => v && v !== "none");

let failures = 0;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function pass(msg) {
  log(`  [32m✓[39m ${msg}`);
}

function fail(msg, detail) {
  failures += 1;
  log(`  [31m✗[39m ${msg}`);
  if (detail)
    log(
      detail
        .split("\n")
        .slice(0, 12)
        .map((l) => `      ${l}`)
        .join("\n"),
    );
}

function run(cmd, cmdArgs, cwd) {
  return spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", shell: false });
}

/** Publishable workspace packages, in no particular order. */
function publishablePackages() {
  const dir = path.join(ROOT, "packages");
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "package.json")))
    .map((p) => ({
      dir: p,
      json: JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8")),
    }))
    .filter((p) => !p.json.private);
}

function packAll(destination) {
  const packages = publishablePackages();
  const tarballs = {};

  for (const { dir, json } of packages) {
    const result = run("pnpm", ["pack", "--pack-destination", destination], dir);
    if (result.status !== 0) {
      throw new Error(`pnpm pack failed for ${json.name}:\n${result.stderr || result.stdout}`);
    }
    // pnpm prints the tarball path on the last non-empty stdout line.
    const produced = result.stdout.trim().split("\n").filter(Boolean).pop().trim();
    tarballs[json.name] = path.resolve(destination, path.basename(produced));
  }
  return tarballs;
}

/**
 * Redirect every `@zintljs/*` dep to its local tarball.
 *
 * Those exact versions are not on the registry yet, and `overrides` is the only
 * mechanism npm honours for a transitive dependency of a `file:` tarball.
 */
function tarballOverrides(tarballs) {
  const overrides = {};
  for (const [name, tarball] of Object.entries(tarballs)) {
    if (name !== "zintljs") overrides[name] = `file:${tarball}`;
  }
  return overrides;
}

/**
 * The application itself — identical for every host.
 *
 * Deliberately so, and for the same reason `examples/rsbuild-vanilla-basic` mirrors
 * `examples/vanilla-spa-basic`: if the app is the same, any difference in the
 * result is attributable to the host rather than to what it was asked to build.
 *
 * The anchor is dynamic (not `zintl("en")`) so BOTH locales are emitted as
 * chunks. With a literal the compiler correctly drops the unreachable `ar`
 * catalog, which would make the translation assertion a false negative on an
 * otherwise perfect build.
 */
function writeApp(dir, { scriptTag }) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
      `    <title>Zintl smoke test</title>\n  </head>\n  <body>\n` +
      `    <div id="app"></div>\n${scriptTag}` +
      `  </body>\n</html>\n`,
  );

  fs.writeFileSync(
    path.join(dir, "src/main.js"),
    `import { zintl } from "zintljs/macro";\n\n` +
      `async function render() {\n` +
      `  const lang = new URLSearchParams(window.location.search).get("lang") || "en";\n` +
      `  await zintl(lang);\n` +
      `  document.querySelector("#app").innerHTML = \`<h1>Hello world</h1><p>Welcome to the application.</p>\`;\n` +
      `}\n\n` +
      `render();\n`,
  );
}

function writeFixture(dir, tarballs, viteMajor) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: `zintl-smoke-vite${viteMajor}`,
        private: true,
        type: "module",
        version: "0.0.0",
        dependencies: {
          zintljs: `file:${tarballs.zintljs}`,
          vite: `^${viteMajor}.0.0`,
        },
        overrides: tarballOverrides(tarballs),
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(
    path.join(dir, "vite.config.js"),
    `import { defineConfig } from "vite";\n` +
      `import zintl from "zintljs/vite";\n\n` +
      `export default defineConfig({\n` +
      `  logLevel: "warn",\n` +
      `  plugins: [zintl({ sourceLocale: "en", locales: ["en", "ar"] })],\n` +
      `});\n`,
  );

  writeApp(dir, {
    scriptTag: `    <script type="module" src="/src/main.js"></script>\n`,
  });
}

/**
 * The same app, built by Rsbuild through the `zintljs/rsbuild` entry point.
 *
 * Two differences from the Vite fixture, both of them the host's rather than
 * ours: the entry is named in the config (`source.entry`) instead of by a
 * `<script src>` in the template — which is the whole of ledger L-021 — and the
 * config is `.mjs`, matching what `examples/rsbuild-vanilla-basic` ships and what the
 * documentation tells a user to write.
 */
function writeRsbuildFixture(dir, tarballs) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "zintl-smoke-rsbuild",
        private: true,
        type: "module",
        version: "0.0.0",
        dependencies: {
          zintljs: `file:${tarballs.zintljs}`,
          "@rsbuild/core": RSBUILD_RANGE,
        },
        overrides: tarballOverrides(tarballs),
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(
    path.join(dir, "rsbuild.config.mjs"),
    `import { defineConfig } from "@rsbuild/core";\n` +
      `import zintl from "zintljs/rsbuild";\n\n` +
      `export default defineConfig({\n` +
      `  plugins: [...zintl({ sourceLocale: "en", locales: ["en", "ar"] })],\n` +
      `  source: { entry: { index: "./src/main.js" } },\n` +
      `  html: { template: "./index.html" },\n` +
      `});\n`,
  );

  writeApp(dir, { scriptTag: "" });
}

const TRANSLATIONS = {
  "Hello world": "مرحبا بالعالم",
  "Welcome to the application.": "أهلا بك في التطبيق.",
};

/** Fill every scaffolded target catalog. Returns the files it touched. */
function fillCatalogs(dir) {
  const filled = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.name.endsWith(".ar.json")) {
        const json = JSON.parse(fs.readFileSync(full, "utf8"));
        let changed = false;
        for (const key of Object.keys(json)) {
          if (key === "$schema" || json[key] !== "") continue;
          json[key] = TRANSLATIONS[key] ?? "نص مترجم";
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`);
          filled.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  return filled;
}

function readDistText(dir) {
  const distDir = path.join(dir, "dist");
  if (!fs.existsSync(distDir)) return "";
  let text = "";
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else text += fs.readFileSync(full, "utf8");
    }
  };
  walk(distDir);
  return text;
}

function smokeOne(viteMajor, tarballs, workspace) {
  log(`\n[1m── Vite ${viteMajor} ─────────────────────────────[22m`);
  const dir = path.join(workspace, `vite${viteMajor}`);
  writeFixture(dir, tarballs, viteMajor);

  // 1. Install with npm — catches pnpm-only protocol leaks and peer conflicts.
  const install = run("npm", ["install", "--silent", "--no-audit", "--no-fund"], dir);
  if (install.status !== 0) {
    fail(`npm install failed`, install.stderr || install.stdout);
    return;
  }
  pass("installs cleanly with npm (no protocol leak, no peer conflict)");

  const resolvedVite = JSON.parse(
    fs.readFileSync(path.join(dir, "node_modules/vite/package.json"), "utf8"),
  ).version;
  if (!resolvedVite.startsWith(`${viteMajor}.`)) {
    fail(`expected Vite ${viteMajor}.x, resolved ${resolvedVite}`);
    return;
  }
  pass(`resolved stock vite@${resolvedVite}`);

  // 2. First build must FAIL on the integrity check. That failure is the proof
  //    the plugin loaded, recognised `zintljs/macro`, and extracted the strings.
  const first = run("npx", ["vite", "build"], dir);
  const firstOutput = `${first.stdout}${first.stderr}`;
  if (first.status === 0) {
    fail("expected the integrity check to reject empty translations, but the build passed");
  } else if (firstOutput.includes("Integrity Error")) {
    pass("plugin extracted strings and blocked the build on empty translations");
  } else {
    fail("build failed for an unexpected reason", firstOutput);
    return;
  }

  // 3. Catalogs must have been scaffolded on disk.
  const filled = fillCatalogs(dir);
  if (filled.length === 0) {
    fail("no target catalogs were scaffolded");
    return;
  }
  pass(`scaffolded and filled ${filled.length} catalog file(s): ${filled.join(", ")}`);

  // 4. Second build must succeed and bake the translation into the output.
  const second = run("npx", ["vite", "build"], dir);
  if (second.status !== 0) {
    fail("build failed after translations were supplied", `${second.stdout}${second.stderr}`);
    return;
  }
  pass("builds successfully");

  const dist = readDistText(dir);
  if (!dist.includes("Hello world")) {
    fail("source-locale content is missing from the build output");
    return;
  }
  pass("source-locale content is baked into the output");

  if (!dist.includes(TRANSLATIONS["Hello world"])) {
    fail("translated content never reached the build output");
    return;
  }
  pass("translated content is present in the output");
}

/**
 * The same four phases as {@link smokeOne}, against `zintljs/rsbuild`.
 *
 * Kept as its own function rather than parameterising the Vite one: the two
 * share their assertions, not their mechanics — a different config file, a
 * different CLI, and an entry declared in config rather than in the template.
 * Folding them together would mean a host-shaped conditional in the middle of
 * every phase, which is the shape this project spends its proposals removing.
 */
function smokeRsbuild(tarballs, workspace) {
  log(`\n[1m── Rsbuild ──────────────────────────────[22m`);
  const dir = path.join(workspace, "rsbuild");
  writeRsbuildFixture(dir, tarballs);

  const install = run("npm", ["install", "--silent", "--no-audit", "--no-fund"], dir);
  if (install.status !== 0) {
    fail("npm install failed", install.stderr || install.stdout);
    return;
  }
  pass("installs cleanly with npm (optional peer resolves, no protocol leak)");

  const resolvedRsbuild = JSON.parse(
    fs.readFileSync(path.join(dir, "node_modules/@rsbuild/core/package.json"), "utf8"),
  ).version;
  pass(`resolved stock @rsbuild/core@${resolvedRsbuild}`);

  // The integrity failure is the proof that `zintljs/rsbuild` resolved, loaded
  // through unplugin's Rspack target, and extracted the strings.
  const first = run("npx", ["rsbuild", "build"], dir);
  const firstOutput = `${first.stdout}${first.stderr}`;
  if (first.status === 0) {
    fail("expected the integrity check to reject empty translations, but the build passed");
  } else if (firstOutput.includes("Integrity Error")) {
    pass("plugin extracted strings and blocked the build on empty translations");
  } else {
    fail("build failed for an unexpected reason", firstOutput);
    return;
  }

  const filled = fillCatalogs(dir);
  if (filled.length === 0) {
    fail("no target catalogs were scaffolded");
    return;
  }
  pass(`scaffolded and filled ${filled.length} catalog file(s): ${filled.join(", ")}`);

  const second = run("npx", ["rsbuild", "build"], dir);
  if (second.status !== 0) {
    fail("build failed after translations were supplied", `${second.stdout}${second.stderr}`);
    return;
  }
  pass("builds successfully");

  const dist = readDistText(dir);
  if (!dist.includes("Hello world")) {
    fail("source-locale content is missing from the build output");
    return;
  }
  pass("source-locale content is baked into the output");

  if (!dist.includes(TRANSLATIONS["Hello world"])) {
    fail("translated content never reached the build output");
    return;
  }
  pass("translated content is present in the output");
}

function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "zintl-smoke-"));
  log(`[1mZintl publish smoke test[22m`);
  log(`fixture: ${workspace}`);

  try {
    log(`\npacking tarballs with pnpm…`);
    const tarballs = packAll(workspace);
    for (const [name, tarball] of Object.entries(tarballs)) {
      log(`  ${name} → ${path.basename(tarball)}`);
    }

    for (const viteMajor of matrix) {
      smokeOne(viteMajor, tarballs, workspace);
    }

    if (withRsbuild) {
      smokeRsbuild(tarballs, workspace);
    }
  } finally {
    if (keep) {
      log(`\nfixture kept at ${workspace}`);
    } else {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  log("");
  if (failures > 0) {
    log(`[41m[37m SMOKE FAILED [39m[49m ${failures} check(s) failed`);
    process.exit(1);
  }
  const hosts = [
    matrix.length > 0 ? `Vite ${matrix.join(", ")}` : null,
    withRsbuild ? "Rsbuild" : null,
  ].filter(Boolean);
  log(
    `[42m[37m SMOKE OK [39m[49m the published artifacts install and build on ${hosts.join(" and ")}`,
  );
}

main();
