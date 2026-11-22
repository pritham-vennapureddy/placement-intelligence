import { cn } from "../utils/cn";
import { universalProductLabel } from "@placement/shared";

/** Which assessed-pool tab a student came from. */
export type PoolSource = "OFFLINE" | "COMPETENCY" | "BOTH";

export const POOL_SOURCE_LABELS: Record<PoolSource, string> = {
  OFFLINE: "Assessed pool · Offline",
  COMPETENCY: "Assessed pool · Competency",
  BOTH: "Assessed pool · Offline + Competency",
};

/** Products from any of the shapes the API returns, as universal names (Academy / Intensive / External). */
export function productNames(products: string | null | undefined | { product: { name: string } }[] | { name: string }[]): string[] {
  if (!products) return [];
  const names = typeof products === "string"
    ? products.split(", ").filter(Boolean)
    : products.map((item) => ("product" in item ? item.product.name : item.name));
  return [...new Set(names.map((name) => universalProductLabel(name) ?? name))];
}

/** The student's product, shown next to their name everywhere. */
export function ProductBadge({ products, className }: { products: Parameters<typeof productNames>[0]; className?: string }) {
  const names = productNames(products);
  if (names.length === 0) {
    return <span className={cn("inline-flex rounded-full border border-dashed border-slate-300 px-1.5 py-px text-[10px] font-medium text-slate-400", className)} title="No product on record">No product</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {names.map((name) => (
        <span key={name} className={cn(
          "inline-flex rounded-full px-1.5 py-px text-[10px] font-medium",
          /external/i.test(name) ? "bg-slate-100 text-slate-600" : /intensive/i.test(name) ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700",
        )}>{name}</span>
      ))}
    </span>
  );
}

/** "Offline", "Competency" or both, when the student is in the assessed pool. */
export function PoolBadge({ source, className }: { source: PoolSource | null | undefined; className?: string }) {
  if (!source) return null;
  const text = source === "BOTH" ? "Pool: Offline + Competency" : source === "OFFLINE" ? "Pool: Offline" : "Pool: Competency";
  return <span title={POOL_SOURCE_LABELS[source]} className={cn("inline-flex rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700", className)}>{text}</span>;
}
