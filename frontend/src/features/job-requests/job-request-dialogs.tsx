import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JOB_STATUS_LABELS, jobTransitionNeedsReason, type JobRequestStatus } from "@placement/shared";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { catalogApi, jobRequestsApi } from "../../services/api";
import type { JobRequestDetail } from "../../types/api";

function useJobMutation<T>(job: JobRequestDetail, run: (input: T) => Promise<JobRequestDetail>, message: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async (updated) => {
      queryClient.setQueryData(["job-requests", job.id], updated);
      await queryClient.invalidateQueries({ queryKey: ["job-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success(message);
      onDone();
    },
  });
}

export function ChangeStatusDialog({ job, open, onOpenChange }: { job: JobRequestDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<JobRequestStatus | "">("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) { setStatus(""); setReason(""); }
  }, [open]);
  const needsReason = status !== "" && jobTransitionNeedsReason(job.status, status);
  const save = useJobMutation(job, () => jobRequestsApi.changeStatus(job.id, status as JobRequestStatus, reason.trim() || undefined), "Status updated", () => onOpenChange(false));

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>Currently {JOB_STATUS_LABELS[job.status].toLowerCase()}. Only the allowed next steps are listed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="next-status" label="New status" required>
            <Select value={status || undefined} onValueChange={(value) => setStatus(value as JobRequestStatus)}>
              <SelectTrigger id="next-status" className="h-10 w-full"><SelectValue placeholder="Choose a status" /></SelectTrigger>
              <SelectContent>
                {job.allowedTransitions.map((option) => (
                  <SelectItem key={option} value={option}>{JOB_STATUS_LABELS[option]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="status-reason" label="Reason" required={needsReason} hint={needsReason ? "Required for this change." : "Optional."}>
            <Textarea id="status-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
          {status === "CANCELLED" && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">A cancelled job request cannot be reopened.</p>
          )}
          {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button
            variant={status === "CANCELLED" ? "destructive" : "default"}
            disabled={!status || (needsReason && !reason.trim()) || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            {save.isPending ? "Saving…" : "Change status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReassignOwnerDialog({ job, open, onOpenChange }: { job: JobRequestDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [ownerId, setOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) { setOwnerId(""); setNotes(""); }
  }, [open]);
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: open });
  const save = useJobMutation(job, () => jobRequestsApi.reassign(job.id, ownerId, notes.trim() || undefined), "Owner changed", () => onOpenChange(false));

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign PSM owner</DialogTitle>
          <DialogDescription>
            Currently owned by {job.psmOwner?.fullName ?? "nobody"}. The previous owner stays in the ownership history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="new-owner" label="New owner" required>
            <Select value={ownerId || undefined} onValueChange={setOwnerId}>
              <SelectTrigger id="new-owner" className="h-10 w-full"><SelectValue placeholder="Choose a PSM" /></SelectTrigger>
              <SelectContent>
                {owners.data?.filter((owner) => owner.id !== job.psmOwner?.id).map((owner) => (
                  <SelectItem key={owner.id} value={owner.id}>{owner.fullName}{owner.team ? ` · ${owner.team.name}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="reassign-notes" label="Note" hint="Optional, e.g. why the job is moving.">
            <Textarea id="reassign-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button disabled={!ownerId || save.isPending} onClick={() => save.mutate(undefined)}>
            {save.isPending ? "Saving…" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
