/**
 * A small syntax highlighter, for the four languages this site's code samples
 * are written in.
 *
 * Hand-written rather than a dependency, and the reason is the second principle
 * in CLAUDE.md: a highlighter that ships a grammar for every language on earth
 * would outweigh the entire rest of this site's runtime, to colour perhaps
 * forty code blocks whose languages we choose. If a sample ever needs a
 * language this does not know, it renders unhighlighted, which is the correct
 * failure.
 */

type Rule = { kind: string; re: RegExp };

const COMMON: Rule[] = [
  { kind: "comment", re: /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<=^|\s)#[^\n]*/y },
  { kind: "string", re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/y },
  { kind: "number", re: /\b\d+(?:\.\d+)?\b/y },
];

const KEYWORDS =
  /\b(?:import|export|from|default|const|let|var|function|return|async|await|if|else|for|of|in|new|class|extends|typeof|interface|type|as|true|false|null|undefined|void)\b/y;

const LANGUAGES: Record<string, Rule[]> = {
  ts: [...COMMON, { kind: "keyword", re: KEYWORDS }],
  js: [...COMMON, { kind: "keyword", re: KEYWORDS }],
  json: [
    { kind: "string", re: /"(?:[^"\\]|\\.)*"/y },
    { kind: "number", re: /\b-?\d+(?:\.\d+)?\b/y },
    { kind: "keyword", re: /\b(?:true|false|null)\b/y },
  ],
  bash: [
    { kind: "comment", re: /#[^\n]*/y },
    { kind: "string", re: /"(?:[^"\\]|\\.)*"|'[^']*'/y },
    { kind: "keyword", re: /(?<=^|\s)(?:npm|pnpm|yarn|npx|vp|vpr|cd|git)\b/y },
  ],
};

const ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  jsonc: "json",
  sh: "bash",
  shell: "bash",
  console: "bash",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tokenizes the *raw* source and escapes each token as it is emitted, rather
 * than escaping first and matching over the result — otherwise a `&quot;` from
 * an escaped quote reads as a string delimiter and everything after it is
 * coloured wrong.
 */
export function highlight(code: string, language?: string): string {
  const rules = LANGUAGES[ALIASES[language ?? ""] ?? language ?? ""];
  if (!rules) return escapeHtml(code);

  let out = "";
  let index = 0;

  while (index < code.length) {
    let matched = false;

    for (const rule of rules) {
      rule.re.lastIndex = index;
      const match = rule.re.exec(code);
      if (match && match[0]) {
        out += `<span class="tok-${rule.kind}">${escapeHtml(match[0])}</span>`;
        index += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      out += escapeHtml(code[index]);
      index += 1;
    }
  }

  return out;
}
