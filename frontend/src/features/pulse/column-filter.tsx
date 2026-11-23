import { ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpZA, Filter, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../utils/cn";

export type SortDir = "asc" | "desc";

/**
 * A column header like an Excel autofilter: click to open sort A→Z / Z→A and a
 * ticked list of the column's values (with how many rows each has). Filters
 * apply as you tick.
 */
export function ColumnFilter({
  title, values, selected, onChange, sort, onSort, align = "left", children,
}: {
  title: string;
  /** Every value with its row count, given the other filters. */
  values: { value: string; count: number }[];
  selected: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  sort: SortDir | null;
  onSort: (dir: SortDir | null) => void;
  align?: "left" | "right";
  children?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const active = Boolean(selected && selected.length > 0);
  const shown = useMemo(() => values.filter((item) => item.value.toLowerCase().includes(q.toLowerCase())), [values, q]);
  const isOn = (value: string) => !active || selected!.includes(value);
  const toggle = (value: string) => {
    const current = active ? selected! : values.map((item) => item.value);
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    onChange(next.length === values.length ? undefined : next);
  };
  const allShownOn = shown.every((item) => isOn(item.value));
  const toggleShown = () => {
    const current = new Set(active ? selected! : values.map((item) => item.value));
    for (const item of shown) if (allShownOn) current.delete(item.value); else current.add(item.value);
    const next = [...current];
    onChange(next.length === values.length ? undefined : next);
  };
  const SortIcon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : null;

  return (
    <Popover onOpenChange={(open) => !open && setQ("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 font-medium hover:bg-slate-100 hover:text-slate-900",
            align === "right" && "flex-row-reverse",
            (active || sort) && "text-indigo-700",
          )}
          aria-label={`${title}: sort and filter`}
        >
          <span>{title}</span>
          {SortIcon && <SortIcon size={12} />}
          <Filter size={11} className={cn(active ? "fill-indigo-600 text-indigo-600" : "opacity-30 group-hover:opacity-70")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align === "right" ? "end" : "start"} className="w-64 p-0">
        <div className="grid gap-0.5 border-b border-slate-100 p-1.5">
          <button type="button" onClick={() => onSort(sort === "asc" ? null : "asc")} className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100", sort === "asc" && "bg-indigo-50 text-indigo-700")}>
            <ArrowDownAZ size={14} /> Sort A → Z / smallest first
          </button>
          <button type="button" onClick={() => onSort(sort === "desc" ? null : "desc")} className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100", sort === "desc" && "bg-indigo-50 text-indigo-700")}>
            <ArrowUpZA size={14} /> Sort Z → A / largest first
          </button>
        </div>
        {values.length > 0 && (
          <div className="p-2">
            {values.length > 6 && (
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search values" className="h-8 pl-7 text-xs" />
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Checkbox checked={allShownOn ? true : shown.some((item) => isOn(item.value)) ? "indeterminate" : false} onCheckedChange={toggleShown} />
              {q ? "Select all shown" : "Select all"}
            </label>
            <div className="max-h-60 overflow-y-auto">
              {shown.map((item) => (
                <label key={item.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <Checkbox checked={isOn(item.value)} onCheckedChange={() => toggle(item.value)} />
                  <span className="min-w-0 flex-1 truncate" title={item.value}>{item.value}</span>
                  <span className="tabular-nums text-slate-400">{item.count}</span>
                </label>
              ))}
              {shown.length === 0 && <p className="px-1.5 py-2 text-xs text-slate-400">No values match</p>}
            </div>
            {active && (
              <Button size="sm" variant="ghost" className="mt-1 h-7 w-full text-xs text-rose-600" onClick={() => onChange(undefined)}>
                <X size={12} /> Clear filter
              </Button>
            )}
          </div>
        )}
        {children}
      </PopoverContent>
    </Popover>
  );
}
