import { universalProductLabel } from "@placement/shared";
/**
 * Products show as three universal products everywhere: Academy, Intensive and
 * External. Plans (Smart, Genius, College Plus…) are added into their product.
 */
export const ACADEMY_GROUP_ID = "__academy__";

export function mergeAcademyProducts<T extends { id: string; name: string; category: string | null }>(products: T[], countKeys: readonly (keyof T)[]): T[] {
  // Every category shows as one universal product: Academy, Intensive, External.
  const order = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"];
  const groups = new Map<string, T>();
  for (const product of products) {
    const key = product.category ?? universalProductLabel(product.name) ?? product.name;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...product, id: key === "ACADEMY" ? ACADEMY_GROUP_ID : product.id, name: universalProductLabel(product.category ?? product.name) ?? product.name });
      continue;
    }
    for (const countKey of countKeys) {
      (current as Record<keyof T, unknown>)[countKey] = (Number(current[countKey]) || 0) + (Number(product[countKey]) || 0);
    }
  }
  return [...groups.values()].sort((a, b) => (order.indexOf(a.category ?? "") + 1 || 9) - (order.indexOf(b.category ?? "") + 1 || 9));
}
