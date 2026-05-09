import type { Comment } from "oxc-parser";

interface ParsedComments {
  note?: string;
  contextVars: Record<string, string>;
  ignore?: boolean;
}

export function parseZintlComments(
  nodeStart: number,
  trivias: Comment[] | undefined,
  code: string,
): ParsedComments {
  const result: ParsedComments = { contextVars: {}, ignore: false };
  if (!trivias) return result;

  // We scan the trivias. Only consider those that are "attached" to the node.
  for (const trivia of trivias) {
    if (trivia.start > nodeStart) continue;

    // Proximity check: Is the comment "attached" to the node?
    // 1. Must be on the same or immediately preceding line (max 1 newline gap)
    // 2. No intervening significant code (only whitespace or JSX comment braces)
    const gap = code.slice(trivia.end, nodeStart);
    const newlineCount = (gap.match(/\n/g) || []).length;
    if (newlineCount > 1) continue;

    // Allow whitespace and JSX comment markers in the gap
    if (/[^ \t\r\n{}/ *]/.test(gap)) continue;

    const text = trivia.value.trim();
    if (!text.includes("@zintl-")) continue;

    // Split by @zintl- to handle multiple directives in one comment
    const parts = text.split(/(@zintl-[a-z]+)/);
    for (let i = 1; i < parts.length; i += 2) {
      const directive = parts[i];
      const content = (parts[i + 1] || "").trim();

      if (directive === "@zintl-ignore") {
        result.ignore = true;
      } else if (directive === "@zintl-note") {
        // Only take the first note found if multiple segments have notes
        if (!result.note) result.note = content.startsWith(":") ? content.slice(1).trim() : content;
      } else if (directive === "@zintl-pass") {
        const varRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s]+))/g;
        let match;
        while ((match = varRegex.exec(content)) !== null) {
          const name = match[1];
          const doubleQuoted = match[2];
          const singleQuoted = match[3];
          const expression = match[4];
          const unquoted = match[5];

          if (expression !== undefined) {
            result.contextVars[name] = expression.trim();
          } else if (doubleQuoted !== undefined) {
            result.contextVars[name] = `"${doubleQuoted}"`;
          } else if (singleQuoted !== undefined) {
            result.contextVars[name] = `'${singleQuoted}'`;
          } else if (unquoted !== undefined) {
            // If it's a number or boolean, keep it as is, otherwise quote it
            if (!isNaN(Number(unquoted)) || unquoted === "true" || unquoted === "false") {
              result.contextVars[name] = unquoted;
            } else {
              result.contextVars[name] = `"${unquoted}"`;
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * Heuristic to find comments attached to a node or its logical parents.
 */
export function getAttachedComments(
  node: { start: number },
  parents: any[] | undefined,
  trivias: Comment[] | undefined,
  code: string,
): ParsedComments {
  if (!trivias) return { contextVars: {}, ignore: false };
  // 1. Check direct attachment
  return parseZintlComments(node.start, trivias, code);
}

/**
 * Extracts directives from a raw string (e.g. an HTML comment tag)
 */
export function parseHTMLDirectives(text: string): ParsedComments {
  const result: ParsedComments = { contextVars: {}, ignore: false };
  const cleanText = text.replace(/^<!--/, "").replace(/-->$/, "").trim();

  if (!cleanText.includes("@zintl-")) return result;

  const parts = cleanText.split(/(@zintl-[a-z]+)/);
  for (let i = 1; i < parts.length; i += 2) {
    const directive = parts[i];
    let content = (parts[i + 1] || "").trim();
    if (content.startsWith(":")) content = content.slice(1).trim();

    if (directive === "@zintl-ignore") {
      result.ignore = true;
    } else if (directive === "@zintl-note") {
      if (!result.note) result.note = content;
    } else if (directive === "@zintl-pass") {
      const varRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s]+))/g;
      let match;
      while ((match = varRegex.exec(content)) !== null) {
        const name = match[1];
        const doubleQuoted = match[2];
        const singleQuoted = match[3];
        const expression = match[4];
        const unquoted = match[5];

        if (expression !== undefined) {
          result.contextVars[name] = expression.trim();
        } else if (doubleQuoted !== undefined) {
          result.contextVars[name] = `"${doubleQuoted}"`;
        } else if (singleQuoted !== undefined) {
          result.contextVars[name] = `'${singleQuoted}'`;
        } else if (unquoted !== undefined) {
          if (!isNaN(Number(unquoted)) || unquoted === "true" || unquoted === "false") {
            result.contextVars[name] = unquoted;
          } else {
            result.contextVars[name] = `"${unquoted}"`;
          }
        }
      }
    }
  }

  return result;
}
