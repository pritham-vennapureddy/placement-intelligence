/**
 * Academy has several plans (Smart, Genius, Edge, Career Plus…). Reports show them
 * as one "Academy" row; Intensive and External products stay as they are.
 */
export const ACADEMY_GROUP_ID = "__academy__";

export function mergeAcademyProducts<T extends { id: string; name: string; category: string | null }>(products: T[], countKeys: readonly (keyof T)[]): T[] {
  const academy = products.filter((product) => product.category === "ACADEMY");
  if (academy.length <= 1) return academy.length === 1 ? products.map((product) => (product.category === "ACADEMY" ? { ...product, name: "Academy" } : product)) : products;
  const merged = { ...academy[0]!, id: ACADEMY_GROUP_ID, name: "Academy" } as T;
  for (const key of countKeys) {
    (merged as Record<keyof T, unknown>)[key] = academy.reduce((sum, product) => sum + (Number(product[key]) || 0), 0);
  }
  const firstIndex = products.findIndex((product) => product.category === "ACADEMY");
  const rest = products.filter((product) => product.category !== "ACADEMY");
  rest.splice(Math.min(firstIndex, rest.length), 0, merged);
  return rest;
}
