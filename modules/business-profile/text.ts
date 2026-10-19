/** Whitespace-collapsed, NFKC-normalised, trimmed. */
export const collapse = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/g, " ");

/** Comparison form: collapse + lowercase. Punctuation and digits are NOT altered. */
export const compareForm = (s: string): string => collapse(s).toLowerCase();

/** True when two strings differ only by case or whitespace (a harmless, cosmetic edit). */
export const isCosmeticChange = (a: string, b: string): boolean => a !== b && compareForm(a) === compareForm(b);

export const sameOrCosmetic = (a: string, b: string): boolean => a === b || compareForm(a) === compareForm(b);

/** Key used to detect duplicate / conflicting FAQ questions. */
export const normalizeQuestion = (q: string): string => compareForm(q).replace(/[?!.\s]+$/, "");
