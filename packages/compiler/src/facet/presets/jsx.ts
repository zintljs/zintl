/**
 * What every JSX dialect shares.
 *
 * React, Preact and Solid all write JSX, and all three need the same two
 * conversions when a translation carries markup: the tag map has to be
 * serialized for the runtime, and a JSX opening tag has to become an HTML one.
 * Neither conversion is React-specific — it is the JSX *syntax* being converted,
 * and the syntax is the same in all three — so it lives here rather than being
 * copied into each preset.
 *
 * What is *not* shared is the interesting part, and each dialect declares it
 * itself: how rich text is injected (`dangerouslySetInnerHTML` vs `innerHTML`),
 * how a component takes a reactive dependency on the store, and whether
 * re-running the entry is safe.
 */
import type { TagMapEntry } from "@zintljs/compiler";

/**
 * Rewrite a JSX opening tag as an HTML one.
 *
 * `className=` → `class=` covers React and Preact; Solid and Preact already
 * write `class=`, for which this is a no-op. Braced expressions become template
 * interpolations, so `href={url}` reaches the runtime as `href="${url}"`.
 */
export function convertToHtmlTemplate(tagOpen: string): string {
  let html = tagOpen.replace(/\bclassName=/g, "class=");
  html = html.replace(/([a-zA-Z0-9_-]+)=\{([^}]+)\}/g, (_match, attrName, expr) => {
    return `${attrName}="\${${expr.trim()}}"`;
  });
  return html;
}

/** Serialize a tag map as a JS array literal, with each open tag as a template. */
export function serializeTags(tags: TagMapEntry[]): string {
  const items = tags.map((entry) => {
    const htmlTemplate = convertToHtmlTemplate(entry.originalOpen);
    const escapedHtml = htmlTemplate.replace(/`/g, "\\`").replace(/\bclassName=/g, "class=");
    return `{ alias: ${JSON.stringify(entry.alias)}, originalOpen: \`${escapedHtml}\`, tagName: ${JSON.stringify(entry.tagName)} }`;
  });
  return `[${items.join(", ")}]`;
}

/**
 * The JSX attributes and object fields a dialect scans for strings.
 *
 * Identical across the three dialects today. A preset takes a copy rather than
 * this array itself, so one framework's `targets` option cannot mutate another's.
 */
export const JSX_TARGETS = [
  "jsx:*:aria-label",
  "jsx:*:alt",
  "jsx:*:title",
  "jsx:*:placeholder",
  "jsx:*:aria-description",
  "jsx:*:label",
  "jsx:*:description",
  "jsx:*:tooltip",
  "jsx:html:dir",
] as const;
