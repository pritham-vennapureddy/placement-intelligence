import { ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpZA, Filter, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../utils/cn";

export type SortDir = "asc" | "desc";
type Value = { value: string; count: number };

const BLANK = "(blank)";

/**
 * A column header like an Excel autofilter. Click it for sort buttons, a search
 * box and a ticked list of the column's values with how many rows each has.
 * Ticks are a draft until OK (or Enter), so a big table is filtered once, not
 * on every click; Cancel or clicking away keeps the current filter.
 */
export function ColumnFilter({
  title, values: valuesProp, selected, onChange, sort, onSort, align = "left", children,
}: {
  title: string;
  /**
   * Every value with its row count, given the other filters. Pass a function to
   * work the list out only when the menu opens (big tables stay fast).
   */
  values: Value[] | (() => Value[]);
  selected: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  sort: SortDir | null;
  onSort: (dir: SortDir | null) => void;
  align?: "left" | "right";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  /** Ticked values while the menu is open; null = everything ticked. */
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = Boolean(selected && selected.length > 0);

  // Worked out when the menu opens, not on every render of every header.
  const values = useMemo<Value[]>(() => {
    if (!open) return [];
    const list = typeof valuesProp === "function" ? valuesProp() : valuesProp;
    // Ticked values that no longer have rows (other filters changed) stay visible so they can be unticked.
    const missing = (selected ?? []).filter((value) => !list.some((item) => item.value === value)).map((value) => ({ value, count: 0 }));
    // Blanks last, as in Excel.
    return [...list, ...missing].sort((x, y) => Number(x.value === BLANK) - Number(y.value === BLANK));
  }, [open, valuesProp, selected]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setDraft(active ? new Set(selected) : null);
  }, [open]); // reset only when the menu opens

  const isOn = (value: string) => draft === null || draft.has(value);
  const shown = values.filter((item) => item.value.toLowerCase().includes(q.trim().toLowerCase()));
  const tickedCount = draft === null ? values.length : values.filter((item) => draft.has(item.value)).length;
  const allShownOn = shown.length > 0 && shown.every((item) => isOn(item.value));
  const someShownOn = shown.some((item) => isOn(item.value));

  const toggle = (value: string) => setDraft((current) => {
    const next = new Set(current ?? values.map((item) => item.value));
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  const only = (value: string) => setDraft(new Set([value]));
  const toggleShown = () => setDraft((current) => {
    const next = new Set(current ?? values.map((item) => item.value));
    for (const item of shown) if (allShownOn) next.delete(item.value); else next.add(item.value);
    return next;
  });
  const apply = () => {
    // With a search typed, OK keeps what is ticked among the matches (Excel's behaviour).
    let picked = draft === null ? values.map((item) => item.value) : values.filter((item) => draft.has(item.value)).map((item) => item.value);
    if (q.trim()) picked = picked.filter((value) => shown.some((item) => item.value === value));
    onChange(picked.length === values.length ? undefined : picked);
    setOpen(false);
  };
  const SortIcon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : null;
  const label = (value: string) => (value === BLANK ? "(Blanks)" : value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-slate-200/60 hover:text-slate-900",
            align === "right" && "flex-row-reverse",
            (active || sort) && "text-indigo-700",
          )}
          aria-label={`${title}: sort and filter`}
        >
          <span>{title}</span>
          {SortIcon && <SortIcon size={12} />}
          <span className={cn("grid size-4 place-items-center rounded", active ? "bg-indigo-600 text-white" : "text-slate-400 opacity-50 group-hover:opacity-100")}>
            <Filter size={10} className={active ? "fill-white" : ""} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align === "right" ? "end" : "start"}
        className="w-80 p-0"
        onOpenAutoFocus={(event) => { event.preventDefault(); search.current?.focus(); }}
        onKeyDown={(event) => { if (event.key === "Enter" && values.length > 0) { event.preventDefault(); apply(); } }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <p className="truncate text-xs font-semibold text-slate-800">{title}</p>
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant={sort === "asc" ? "secondary" : "ghost"} className={cn("h-7 gap-1 px-2 text-xs", sort === "asc" && "text-indigo-700")} onClick={() => { onSort(sort === "asc" ? null : "asc"); setOpen(false); }} title="Sort A → Z / smallest first">
              <ArrowDownAZ size={14} /> A–Z
            </Button>
            <Button type="button" size="sm" variant={sort === "desc" ? "secondary" : "ghost"} className={cn("h-7 gap-1 px-2 text-xs", sort === "desc" && "text-indigo-700")} onClick={() => { onSort(sort === "desc" ? null : "desc"); setOpen(false); }} title="Sort Z → A / largest first">
              <ArrowUpZA size={14} /> Z–A
            </Button>
          </div>
        </div>
        {values.length > 0 && (
          <>
            <div className="p-2 pb-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={search}
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={`Search ${values.length} values`}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                {q && <button type="button" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X size={12} /></button>}
              </div>
            </div>
            <div className="px-2">
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
                <Checkbox checked={allShownOn ? true : someShownOn ? "indeterminate" : false} onCheckedChange={toggleShown} />
                {q ? `Select all ${shown.length} matches` : "Select all"}
              </label>
              <div className="max-h-64 overflow-y-auto border-t border-slate-100 py-1" role="listbox" aria-multiselectable>
                {shown.map((item) => (
                  <div key={item.value} className="group/row flex items-center gap-2 rounded px-2 py-1 hover:bg-indigo-50/60">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <Checkbox checked={isOn(item.value)} onCheckedChange={() => toggle(item.value)} />
                      <span className={cn("min-w-0 flex-1 truncate", item.value === BLANK && "italic text-slate-400")} title={label(item.value)}>{label(item.value)}</span>
                    </label>
                    <button type="button" onClick={() => only(item.value)} className="hidden shrink-0 rounded px-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 group-hover/row:block" title={`Show only ${label(item.value)}`}>
                      Only
                    </button>
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] tabular-nums text-slate-500 group-hover/row:hidden">{item.count}</span>
                  </div>
                ))}
                {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-400">No values match “{q}”</p>}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <button type="button" disabled={!active && draft === null} onClick={() => { onChange(undefined); setOpen(false); }}
                className="text-xs font-medium text-rose-600 hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline">
                Clear filter
              </button>
              <span className="text-[11px] text-slate-400">{tickedCount} of {values.length}</span>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="button" size="sm" className="h-7 px-3 text-xs" disabled={tickedCount === 0} onClick={apply}>OK</Button>
              </div>
            </div>
          </>
        )}
        {children}
      </PopoverContent>
    </Popover>
  );
}
