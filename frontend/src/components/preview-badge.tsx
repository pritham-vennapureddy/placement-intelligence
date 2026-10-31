import { Sparkles } from "lucide-react";

/** Marks sample data that is not yet backed by the database. */
export function PreviewBadge({ label = "Preview data" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
      <Sparkles size={12} /> {label}
    </span>
  );
}
