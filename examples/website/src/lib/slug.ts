/**
 * The anchor a heading gets.
 *
 * Its own module because two things need it and they run in different worlds:
 * the Markdown renderer in the browser, and the search-index plugin in Node. If
 * they ever disagreed, every search result would land at the top of its page
 * instead of at the heading it promised — a failure that looks like a styling
 * bug and is not one.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
