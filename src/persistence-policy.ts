export function parsePersistedStateText<T extends object>(raw: string): Record<string, T> {
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

export function serializePersistedState<T>(entries: Iterable<readonly [string, T]>): string {
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

export function parseRecentActivityText<T>(raw: string, limit: number): T[] {
  try {
    return raw
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as T)
      .reverse();
  } catch {
    return [];
  }
}
