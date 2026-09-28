/**
 * Text helpers shared by the server pipeline and the client bundle. Keep this
 * module free of server-only imports (no rss-parser, no node: modules).
 */

/** Lowercases and strips diacritics and a few ligatures: "Électricité" folds to "electricite". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l");
}

/** Stable key for near-identical headlines: folded, alphanumerics only, capped at 90 chars. */
export function titleKey(title: string): string {
  return fold(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 90);
}
