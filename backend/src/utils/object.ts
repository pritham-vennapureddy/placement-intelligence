/** Drops keys whose value is undefined (partial updates leave untouched fields out). */
export function definedOnly<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, inner]) => inner !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
