export const LIST_SEARCH_QUERY_MAX_LENGTH = 100;

export function readListSearchQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, LIST_SEARCH_QUERY_MAX_LENGTH) : "";
}

export function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

export function searchWords(query: string) {
  return normalizeSearchText(query).match(/\S+/g) ?? [];
}

export function includesSearchWords(words: readonly string[], ...normalizedFields: string[]) {
  return words.every((word) => normalizedFields.some((field) => field.includes(word)));
}

export function wordSearchMatcher(query: string) {
  const words = searchWords(query);
  return (...values: Array<string | null | undefined>) =>
    words.length === 0 || includesSearchWords(words, normalizeSearchText(values.join(" ")));
}
