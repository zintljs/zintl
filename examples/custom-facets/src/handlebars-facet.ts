import type { ZintlFacet } from "@zintl/compiler";

export function createHandlebarsFacet(): ZintlFacet[] {
  return [
    {
      name: "handlebars-extraction",
      concern: "extraction",
      priority: 20,
      extensions: [".hbs"],
      targets: [],
      sfcRules: [
        {
          extensions: [".hbs"],
          blocks: [
            {
              id: "template",
              pattern: /^([\s\S]*)$/gi,
              action: "html",
              isActiveContent: true,
            },
          ],
        },
      ],
      mustacheRegex: /\{\{([\s\S]*?)\}\}/g,
    },
    {
      name: "handlebars-codegen-helper",
      concern: "codegen",
      priority: 20,
      sfc: true,
      extensions: [".hbs"],
      match: (id: string) => id.endsWith(".hbs"),
      wrapHtmlText: (replacement: string, hasTags: boolean, hasVars: boolean) => {
        if (replacement.startsWith("_t(")) {
          let match = replacement.match(
            /^_t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*\{([\s\S]*?)\}\s*,\s*\{([\s\S]*?)\}\s*\)$/,
          );
          if (match) {
            const key = match[1].trim();
            const paramsStr = match[2].trim();
            const optionsStr = match[3].trim();

            const parsePairs = (str: string) => {
              const pairs: string[] = [];
              const rawPairs = str
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              for (const rp of rawPairs) {
                const parts = rp.split(":").map((s) => s.trim());
                if (parts.length === 2) {
                  pairs.push(`${parts[0]}=${parts[1]}`);
                }
              }
              return pairs;
            };

            const allArgs = [...parsePairs(paramsStr), ...parsePairs(optionsStr)];
            const argsPart = allArgs.length > 0 ? " " + allArgs.join(" ") : "";
            return `{{_t ${key}${argsPart}}}`;
          }

          match = replacement.match(
            /^_t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*\{([\s\S]*?)\}\s*\)$/,
          );
          if (match) {
            const key = match[1].trim();
            const optionsStr = match[2].trim();

            const parsePairs = (str: string) => {
              const pairs: string[] = [];
              const rawPairs = str
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              for (const rp of rawPairs) {
                const parts = rp.split(":").map((s) => s.trim());
                if (parts.length === 2) {
                  pairs.push(`${parts[0]}=${parts[1]}`);
                }
              }
              return pairs;
            };

            const allArgs = parsePairs(optionsStr);
            const argsPart = allArgs.length > 0 ? " " + allArgs.join(" ") : "";
            return `{{_t ${key}${argsPart}}}`;
          }
        }

        if (hasVars) {
          const parts = replacement.split("+").map((p) => p.trim());
          let hbs = "";
          for (const part of parts) {
            if (
              (part.startsWith("'") && part.endsWith("'")) ||
              (part.startsWith('"') && part.endsWith('"'))
            ) {
              hbs += part.slice(1, -1);
            } else {
              hbs += `{{${part}}}`;
            }
          }
          return hbs;
        }

        if (
          (replacement.startsWith("'") && replacement.endsWith("'")) ||
          (replacement.startsWith('"') && replacement.endsWith('"'))
        ) {
          return replacement.slice(1, -1);
        }
        return replacement;
      },
      wrapHtmlAttribute: (attrName: string, replacement: string, hasVars: boolean) => {
        if (replacement.startsWith("_t(")) {
          let match = replacement.match(
            /^_t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*\{([\s\S]*?)\}\s*,\s*\{([\s\S]*?)\}\s*\)$/,
          );
          if (match) {
            const key = match[1].trim();
            const paramsStr = match[2].trim();
            const optionsStr = match[3].trim();

            const parsePairs = (str: string) => {
              const pairs: string[] = [];
              const rawPairs = str
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              for (const rp of rawPairs) {
                const parts = rp.split(":").map((s) => s.trim());
                if (parts.length === 2) {
                  pairs.push(`${parts[0]}=${parts[1]}`);
                }
              }
              return pairs;
            };

            const allArgs = [...parsePairs(paramsStr), ...parsePairs(optionsStr)];
            const argsPart = allArgs.length > 0 ? " " + allArgs.join(" ") : "";
            return `${attrName}="{{_t ${key}${argsPart}}}"`;
          }

          match = replacement.match(
            /^_t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*\{([\s\S]*?)\}\s*\)$/,
          );
          if (match) {
            const key = match[1].trim();
            const optionsStr = match[2].trim();

            const parsePairs = (str: string) => {
              const pairs: string[] = [];
              const rawPairs = str
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              for (const rp of rawPairs) {
                const parts = rp.split(":").map((s) => s.trim());
                if (parts.length === 2) {
                  pairs.push(`${parts[0]}=${parts[1]}`);
                }
              }
              return pairs;
            };

            const allArgs = parsePairs(optionsStr);
            const argsPart = allArgs.length > 0 ? " " + allArgs.join(" ") : "";
            return `${attrName}="{{_t ${key}${argsPart}}}"`;
          }
        }

        if (hasVars) {
          const parts = replacement.split("+").map((p) => p.trim());
          let hbs = "";
          for (const part of parts) {
            if (
              (part.startsWith("'") && part.endsWith("'")) ||
              (part.startsWith('"') && part.endsWith('"'))
            ) {
              hbs += part.slice(1, -1);
            } else {
              hbs += `{{${part}}}`;
            }
          }
          return `${attrName}="${hbs}"`;
        }

        if (
          (replacement.startsWith("'") && replacement.endsWith("'")) ||
          (replacement.startsWith('"') && replacement.endsWith('"'))
        ) {
          return `${attrName}="${replacement.slice(1, -1)}"`;
        }
        return `${attrName}="${replacement}"`;
      },
    },
  ];
}
