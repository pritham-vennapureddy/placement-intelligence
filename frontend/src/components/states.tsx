import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "../services/api";
import { cn } from "../utils/cn";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon size={20} />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
        <AlertTriangle size={20} />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-800">Could not load this data</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{message}</p>
      {requestId && <p className="mt-1 font-mono text-[11px] text-slate-400">Reference: {requestId}</p>}
      {onRetry && (
        <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}
