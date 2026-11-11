import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

/**
 * Confirmation for critical actions. Stays open while `onConfirm` runs and
 * shows its error inline, so a failed action is never silently dismissed.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    setRequestId(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The action could not be completed.");
      if (typeof confirmError === "object" && confirmError !== null && "requestId" in confirmError && typeof confirmError.requestId === "string") {
        setRequestId(confirmError.requestId);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <div role="alert" className="space-y-1 text-sm text-rose-600"><p>{error}</p>{requestId && <p className="text-xs text-slate-500">Reference ID: {requestId}</p>}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={() => void confirm()}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
