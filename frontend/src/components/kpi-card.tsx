import type { LucideIcon } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../utils/cn";

const tones = {
  indigo: "bg-indigo-50 text-indigo-600",
  sky: "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
} as const;

const numberFormat = new Intl.NumberFormat("en-IN");

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "indigo",
  hint,
  loading = false,
}: {
  label: string;
  value: number | string | null | undefined;
  icon: LucideIcon;
  tone?: keyof typeof tones;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        {loading ? (
          <Skeleton className="h-7 w-14" />
        ) : (
          <p className="text-xl font-semibold text-slate-900">
            {typeof value === "number" ? numberFormat.format(value) : (value ?? "—")}
          </p>
        )}
        <p className="truncate text-xs text-slate-500">{label}</p>
        {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
