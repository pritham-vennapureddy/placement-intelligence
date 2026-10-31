import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useDashboardFilters } from "../hooks/use-dashboard-filters";
import { catalogApi } from "../services/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const ALL = "__all__";

/** Date, product and tech-stack filters for dashboard views, stored in the URL. */
export function FilterBar() {
  const { filters, setFilter, clearFilters, hasFilters } = useDashboardFilters();
  const products = useQuery({ queryKey: ["catalog", "products"], queryFn: catalogApi.products, staleTime: 5 * 60_000 });
  const skills = useQuery({ queryKey: ["catalog", "skills"], queryFn: catalogApi.skills, staleTime: 5 * 60_000 });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:flex-row lg:items-end">
      <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Requested from</span>
          <Input
            type="date"
            className="h-9"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(event) => setFilter("from", event.target.value || null)}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Requested to</span>
          <Input
            type="date"
            className="h-9"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(event) => setFilter("to", event.target.value || null)}
          />
        </label>
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Product</span>
          <Select value={filters.productId ?? ALL} onValueChange={(value) => setFilter("productId", value === ALL ? null : value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Product">
              <SelectValue placeholder="All products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All products</SelectItem>
              {filters.productId && !products.data?.some((product) => product.id === filters.productId) && (
                <SelectItem value={filters.productId}>Unknown product</SelectItem>
              )}
              {products.data?.map((product) => (
                <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tech stack</span>
          <Select value={filters.skill ?? ALL} onValueChange={(value) => setFilter("skill", value === ALL ? null : value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Tech stack">
              <SelectValue placeholder="All tech stacks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tech stacks</SelectItem>
              {filters.skill && !skills.data?.some((skill) => skill.normalizedName === filters.skill) && (
                <SelectItem value={filters.skill}>{filters.skill}</SelectItem>
              )}
              {skills.data?.map((skill) => (
                <SelectItem key={skill.id} value={skill.normalizedName}>{skill.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={clearFilters}>
          <X size={14} /> Clear filters
        </Button>
      )}
    </div>
  );
}
