import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { companiesApi } from "../../services/api";
import { cn } from "../../utils/cn";

/** Searchable company selector with a shortcut to add a new company. */
export function CompanyPicker({
  id,
  value,
  onChange,
  onCreate,
  invalid,
}: {
  id?: string;
  value: { id: string; name: string } | null;
  onChange: (company: { id: string; name: string }) => void;
  onCreate?: (() => void) | undefined;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const results = useQuery({
    queryKey: ["companies", "picker", debounced],
    queryFn: () => companiesApi.list({ pageSize: 20, status: "ACTIVE", ...(debounced ? { search: debounced } : {}) }),
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border bg-white px-3 text-left text-sm",
            invalid ? "border-rose-400" : "border-input",
            !value && "text-slate-400",
          )}
        >
          <span className="flex items-center gap-2 truncate"><Building2 size={15} className="text-slate-400" />{value?.name ?? "Choose a company"}</span>
          <ChevronsUpDown size={15} className="text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <label className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search size={14} className="text-slate-400" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search companies…"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <div className="max-h-64 overflow-y-auto p-1">
          {results.isPending && <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>}
          {results.data?.items.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No active company matches.</p>}
          {results.data?.items.map((company) => (
            <button
              key={company.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                onChange({ id: company.id, name: company.name });
                setOpen(false);
              }}
            >
              <span>
                {company.name}
                <span className="ml-2 text-xs text-slate-400">{company.location ?? ""}</span>
              </span>
              {value?.id === company.id && <Check size={14} className="text-indigo-600" />}
            </button>
          ))}
        </div>
        {onCreate && (
          <div className="border-t border-slate-100 p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
            >
              <Plus size={14} /> Add a new company
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
