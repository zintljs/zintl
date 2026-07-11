import { defineConfig } from "vite-plus";
import zintl from "zintl/vite";
import { resolve } from "node:path";
import { handlebarsFacet, multiBrandThemeFacet } from "@zintl-examples/custom-facets";

export default defineConfig({
  plugins: [
    zintl({
      sourceLocale: "en",
      locales: ["en", "ar"],
      outputDir: "./src/i18n",
      catalogFormat: "[path].[locale].json",
      verifyIntegrity: false,
      facets: ["auto", handlebarsFacet(), multiBrandThemeFacet()],
    }) as any,
    {
      name: "hbs-compiler",
      transform(code, id) {
        if (id.endsWith(".hbs")) {
          console.log("[HbsCompiler] Transforming:", id);

          // Extract Zintl prepended imports
          const imports: string[] = [];
          const template = code.replace(/^\s*import\s+[\s\S]*?;\n?/gm, (match) => {
            imports.push(match.trim());
            return "";
          });

          // Compile mustache syntax to template literal parts
          const compiled = template.replace(/\{\{([\s\S]*?)\}\}/g, (match, expr) => {
            const trimmed = expr.trim();
            if (trimmed.startsWith("_t ")) {
              const keyMatch = trimmed.match(/^_t\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
              if (!keyMatch) return match;
              const key = keyMatch[1];
              const rest = trimmed.substring(keyMatch[0].length).trim();
              const parts = rest.split(/\s+/).filter(Boolean);
              const varArgs: string[] = [];
              for (const part of parts) {
                const pair = part.split("=");
                if (pair.length === 2) {
                  const k = pair[0];
                  let v = pair[1];
                  if (
                    !(
                      (v.startsWith("'") && v.endsWith("'")) ||
                      (v.startsWith('"') && v.endsWith('"'))
                    )
                  ) {
                    v = `finalContext.${v}`;
                  }
                  varArgs.push(`"${k}": ${v}`);
                }
              }
              if (!varArgs.some((a) => a.startsWith('"_mgr"'))) {
                varArgs.push(`"_mgr": finalContext._mgr`);
              }
              if (!varArgs.some((a) => a.startsWith('"_bId"'))) {
                varArgs.push(`"_bId": finalContext._bId`);
              }
              return `\${_t(${key}, { ${varArgs.join(", ")} })}`;
            } else {
              return `\${finalContext.${trimmed}}`;
            }
          });

          const mgrMatch = imports.join("\n").match(/import\s+([a-zA-Z0-9_]+)\s+from/);
          const mgrVar = mgrMatch ? mgrMatch[1] : "undefined";
          const hasTImport = imports.some((imp) => imp.includes("_t"));
          const tImportLine = hasTImport ? "" : `import { _t } from "zintl/internal";`;

          return {
            code: `
              ${tImportLine}
              ${imports.join("\n")}
              export default function(context = {}) {
                const finalContext = { _mgr: ${mgrVar}, ...context };
                return \`${compiled}\`;
              }
            `,
            map: null,
          };
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
});
