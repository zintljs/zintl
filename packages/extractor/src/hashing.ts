import { createHash } from "node:crypto";

/**
 * Generates a stable ID for a message based on its text, context, and note.
 * Including the note ensures that identical strings with different translator
 * context are treated as unique entries.
 */
const idCache = new Map<string, string>();

export function generateMessageId(
  messageText: string,
  _context: string = "",
  _note: string = "",
): string {
  const cached = idCache.get(messageText);
  if (cached) return cached;

  const id = createHash("sha1").update(messageText).digest("hex").slice(0, 8);
  idCache.set(messageText, id);
  return id;
}
