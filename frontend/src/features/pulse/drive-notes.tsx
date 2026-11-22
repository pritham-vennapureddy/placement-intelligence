import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CRM_CHANNEL_LABELS, CRM_CHANNELS, type CrmChannel } from "@placement/shared";
import { format } from "date-fns";
import { ExternalLink, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormField } from "../../components/form-field";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useAuth } from "../../contexts/auth-context";
import { driveNotesApi } from "../../services/pulse-api";
import type { CrmRemark } from "../../types/pulse";

const today = () => format(new Date(), "yyyy-MM-dd");
const dateText = (value: string) => format(new Date(`${value}T00:00:00`), "d MMM yyyy");

/** Refreshes every view that shows CRM remarks or RSA notes. */
function useNotesRefresh(jobRequestId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["drive-notes", jobRequestId] }),
    queryClient.invalidateQueries({ queryKey: ["monthly-pipeline"] }),
    queryClient.invalidateQueries({ queryKey: ["company-notes"] }),
  ]);
}

function RemarkForm({ jobRequestId, remark, onDone }: { jobRequestId: string; remark?: CrmRemark; onDone: () => void }) {
  const refresh = useNotesRefresh(jobRequestId);
  const [interactionOn, setInteractionOn] = useState(remark?.interactionOn ?? today());
  const [channel, setChannel] = useState<CrmChannel>(remark?.channel ?? "CALL");
  const [text, setText] = useState(remark?.remark ?? "");
  const [nextStep, setNextStep] = useState(remark?.nextStep ?? "");
  const save = useMutation({
    mutationFn: () => {
      const input = { interactionOn, channel, remark: text.trim(), nextStep: nextStep.trim() || null };
      return remark ? driveNotesApi.updateRemark(jobRequestId, remark.id, input) : driveNotesApi.addRemark(jobRequestId, input);
    },
    onSuccess: async () => { await refresh(); toast.success(remark ? "Remark updated" : "Remark added"); onDone(); },
  });
  const id = remark?.id ?? "new";
  return (
    <form
      className="grid gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3"
      onSubmit={(event) => { event.preventDefault(); if (text.trim()) save.mutate(); }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`crm-date-${id}`} label="Interaction date" required>
          <Input id={`crm-date-${id}`} type="date" max={today()} value={interactionOn} onChange={(event) => setInteractionOn(event.target.value)} required />
        </FormField>
        <FormField id={`crm-channel-${id}`} label="Channel">
          <Select value={channel} onValueChange={(value) => setChannel(value as CrmChannel)}>
            <SelectTrigger id={`crm-channel-${id}`}><SelectValue /></SelectTrigger>
            <SelectContent>{CRM_CHANNELS.map((value) => <SelectItem key={value} value={value}>{CRM_CHANNEL_LABELS[value]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      </div>
      <FormField id={`crm-remark-${id}`} label="What the company said" required>
        <Textarea id={`crm-remark-${id}`} rows={3} maxLength={3000} value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. Liked the profiles but wants stronger DSA; will share TR1 slots next week." required />
      </FormField>
      <FormField id={`crm-next-${id}`} label="Next step (optional)">
        <Input id={`crm-next-${id}`} maxLength={1000} value={nextStep} onChange={(event) => setNextStep(event.target.value)} placeholder="e.g. Follow up on 28 Nov for TR1 schedule" />
      </FormField>
      {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending || !text.trim()}>{save.isPending ? "Saving…" : remark ? "Save remark" : "Add remark"}</Button>
      </div>
    </form>
  );
}

function CrmRemarks({ jobRequestId, remarks }: { jobRequestId: string; remarks: CrmRemark[] }) {
  const { user } = useAuth();
  const refresh = useNotesRefresh(jobRequestId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CrmRemark | null>(null);
  const isAdmin = user?.roles.includes("ADMIN") ?? false;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">CRM remarks</h2>
          <p className="mt-0.5 text-xs text-slate-500">What the company told us on each interaction for this drive, newest first.</p>
        </div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add remark</Button>}
      </div>
      <div className="mt-4 grid gap-3">
        {adding && <RemarkForm jobRequestId={jobRequestId} onDone={() => setAdding(false)} />}
        {remarks.length === 0 && !adding && (
          <EmptyState icon={MessageSquareText} title="No CRM remarks yet" description="Log what the company says after each call, email or meeting, so anyone can see where the relationship stands." className="py-6" />
        )}
        <ol className="grid gap-3">
          {remarks.map((remark) => editing === remark.id ? (
            <li key={remark.id}><RemarkForm jobRequestId={jobRequestId} remark={remark} onDone={() => setEditing(null)} /></li>
          ) : (
            <li key={remark.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{dateText(remark.interactionOn)}</span>
                  <Badge variant="outline" className="text-[11px]">{CRM_CHANNEL_LABELS[remark.channel]}</Badge>
                  <span>by {remark.createdBy.fullName}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit remark" onClick={() => setEditing(remark.id)}><Pencil size={13} /></Button>
                  {(remark.createdBy.id === user?.id || isAdmin) && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" aria-label="Delete remark" onClick={() => setDeleting(remark)}><Trash2 size={13} /></Button>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{remark.remark}</p>
              {remark.nextStep && <p className="mt-1.5 text-xs text-indigo-700"><span className="font-semibold">Next step:</span> {remark.nextStep}</p>}
            </li>
          ))}
        </ol>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this remark?"
        description={deleting ? <>The remark from {dateText(deleting.interactionOn)} will be removed.</> : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await driveNotesApi.deleteRemark(jobRequestId, deleting.id);
          await refresh();
          toast.success("Remark deleted");
          setDeleting(null);
        }}
      />
    </Card>
  );
}

const REVIEW_FIELDS = [
  { key: "wentRight", label: "What went right", placeholder: "e.g. Pool students cleared the assessment well; profiles reached the company within 2 days.", tone: "text-emerald-700" },
  { key: "wentWrong", label: "What went wrong", placeholder: "e.g. Most rejections in TR1 on SQL joins; 4 no-shows in TR2; JD mismatch on Java.", tone: "text-rose-700" },
  { key: "actionItems", label: "Action items", placeholder: "e.g. SQL mock before every data drive; confirm availability a day before rounds.", tone: "text-indigo-700" },
] as const;

function RsaReviewCard({ jobRequestId, notes }: { jobRequestId: string; notes: NonNullable<ReturnType<typeof useDriveNotes>["data"]> }) {
  const refresh = useNotesRefresh(jobRequestId);
  const review = notes.rsaReview;
  const [values, setValues] = useState({ wentRight: "", wentWrong: "", actionItems: "" });
  useEffect(() => {
    setValues({ wentRight: review?.wentRight ?? "", wentWrong: review?.wentWrong ?? "", actionItems: review?.actionItems ?? "" });
  }, [review?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = REVIEW_FIELDS.some(({ key }) => values[key].trim() !== (review?.[key] ?? ""));
  const save = useMutation({
    mutationFn: () => driveNotesApi.saveRsaReview(jobRequestId, {
      wentRight: values.wentRight.trim() || null, wentWrong: values.wentWrong.trim() || null, actionItems: values.actionItems.trim() || null,
    }),
    onSuccess: async () => { await refresh(); toast.success("RSA review saved"); },
  });
  const reports = notes.studentReports;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">RSA review of this drive</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Rejection section analysis for the drive as a whole.
            {review?.updatedBy && <> Last saved by {review.updatedBy.fullName} on {format(new Date(review.updatedAt), "d MMM yyyy")}.</>}
          </p>
        </div>
        <Link to="/rsa" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">
          Student RSA reports: {reports.done} done of {reports.total} on file{reports.withLink ? `, ${reports.withLink} with report link` : ""} <ExternalLink size={12} />
        </Link>
      </div>
      <form className="mt-4 grid gap-4 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {REVIEW_FIELDS.map((field) => (
          <FormField key={field.key} id={`rsa-${field.key}`} label={field.label}>
            <Textarea
              id={`rsa-${field.key}`}
              rows={6}
              maxLength={5000}
              value={values[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </FormField>
        ))}
        <div className="flex items-center justify-end gap-3 lg:col-span-3">
          {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save review"}</Button>
        </div>
      </form>
    </Card>
  );
}

function useDriveNotes(jobRequestId: string) {
  return useQuery({ queryKey: ["drive-notes", jobRequestId], queryFn: () => driveNotesApi.get(jobRequestId) });
}

/** Job detail tab: CRM remarks log and the drive's RSA review. */
export function DriveNotesTab({ jobRequestId }: { jobRequestId: string }) {
  const notes = useDriveNotes(jobRequestId);
  if (notes.isPending) return <Card><LoadingRows /></Card>;
  if (notes.error) return <Card><ErrorState error={notes.error} onRetry={() => void notes.refetch()} /></Card>;
  return (
    <div className="grid gap-4">
      <CrmRemarks jobRequestId={jobRequestId} remarks={notes.data.crmRemarks} />
      <RsaReviewCard jobRequestId={jobRequestId} notes={notes.data} />
    </div>
  );
}
