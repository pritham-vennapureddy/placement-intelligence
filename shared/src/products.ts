/**
 * The whole application shows three universal products. Detailed plans
 * (CCBP Academy Smart, CCBP Intensive, Intensive College Plus…) map onto them.
 */
export const UNIVERSAL_PRODUCTS = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"] as const;
export type UniversalProduct = (typeof UNIVERSAL_PRODUCTS)[number];

export const UNIVERSAL_PRODUCT_LABELS: Record<UniversalProduct, string> = {
  ACADEMY: "Academy",
  ACADEMY_INTENSIVE: "Intensive",
  EXTERNAL: "External",
};

/** "CCBP Academy Smart" → "Academy", "Intensive College Plus" → "Intensive", a category key → its label. */
export function universalProductLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value in UNIVERSAL_PRODUCT_LABELS) return UNIVERSAL_PRODUCT_LABELS[value as UniversalProduct];
  if (/intensive/i.test(value)) return "Intensive";
  if (/external/i.test(value)) return "External";
  if (/academy/i.test(value)) return "Academy";
  return value;
}
