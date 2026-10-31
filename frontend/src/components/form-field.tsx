import type { ReactNode } from "react";
import { Label } from "./ui/label";

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>
      )}
    </div>
  );
}
