import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { rejectionReasonsApi, type RejectionReason } from "../../services/rejection-reasons-api";

export const REASONS_KEY = ["rejection-reasons"] as const;
const ADD_NEW = "__add_new__";
const NONE = "__none__";

export function useRejectionReasons() {
  return useQuery({ queryKey: REASONS_KEY, queryFn: rejectionReasonsApi.list, staleTime: 60_000 });
}

export interface RejectionValue {
  tagId: string | null;
  note: string;
  docUrl: string;
}

export const emptyRejection = (): RejectionValue => ({ tagId: null, note: "", docUrl: "" });

/** A doc link must be a full http(s) URL; empty is fine. */
export const docUrlError = (url: string) => (url.trim() && !/^https?:\/\/\S+$/i.test(url.trim()) ? "Paste a full link starting with https://" : undefined);

/** Values ready for the API. */
export function rejectionPayload(value: RejectionValue) {
  return { rejectionTagId: value.tagId, rejectionReason: value.note.trim() || null, rejectionDocUrl: value.docUrl.trim() || null };
}

/**
 * The reason dropdown (built-in reasons plus the team's own, with "Add a new
 * reason" at the bottom), a note and a doc link.
 */
export function RejectionReasonFields({ idPrefix, value, onChange }: { idPrefix: string; value: RejectionValue; onChange: (next: RejectionValue) => void }) {
  const queryClient = useQueryClient();
  const reasons = useRejectionReasons();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const create = useMutation({
    mutationFn: () => rejectionReasonsApi.create(label),
    onSuccess: async (reason) => {
      await queryClient.invalidateQueries({ queryKey: REASONS_KEY });
      onChange({ ...value, tagId: reason.id });
      setAdding(false);
      setLabel("");
      toast.success(`Added “${reason.label}” to the reasons`);
    },
  });
  // Removed reasons stay selectable only on a result that already has them.
  const options = (reasons.data ?? []).filter((reason) => !reason.archivedAt || reason.id === value.tagId);
  const urlError = docUrlError(value.docUrl);

  return (
    <div className="grid gap-3 rounded-lg border border-rose-100 bg-rose-50/40 p-3">
      <FormField id={`${idPrefix}-reason`} label="Why did the company reject?" hint="Pick the closest reason. Missing one? Choose “Add a new reason”.">
        {adding ? (
          <div className="flex gap-2">
            <Input id={`${idPrefix}-reason`} autoFocus value={label} maxLength={80} placeholder="e.g. Weak in SQL"
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && label.trim().length >= 2) { event.preventDefault(); create.mutate(); } }} />
            <Button type="button" size="sm" className="h-10" disabled={label.trim().length < 2 || create.isPending} onClick={() => create.mutate()}><Check size={14} /> Add</Button>
            <Button type="button" size="sm" variant="ghost" className="h-10" onClick={() => { setAdding(false); setLabel(""); create.reset(); }}><X size={14} /></Button>
          </div>
        ) : (
          <Select value={value.tagId ?? NONE} onValueChange={(next) => (next === ADD_NEW ? setAdding(true) : onChange({ ...value, tagId: next === NONE ? null : next }))}>
            <SelectTrigger id={`${idPrefix}-reason`} className="h-10 w-full bg-white"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}><span className="text-slate-400">Not tagged yet</span></SelectItem>
              {options.map((reason) => <SelectItem key={reason.id} value={reason.id}>{reason.label}{reason.archivedAt ? " (removed)" : ""}</SelectItem>)}
              <SelectSeparator />
              <SelectItem value={ADD_NEW}><span className="flex items-center gap-1.5 text-indigo-600"><Plus size={13} /> Add a new reason</span></SelectItem>
            </SelectContent>
          </Select>
        )}
        {create.error && <p role="alert" className="mt-1 text-xs text-rose-600">{create.error.message}</p>}
      </FormField>
      <FormField id={`${idPrefix}-note`} label="Note (optional)">
        <Textarea id={`${idPrefix}-note`} rows={2} maxLength={1000} className="bg-white" value={value.note} placeholder="What exactly the company said" onChange={(event) => onChange({ ...value, note: event.target.value })} />
      </FormField>
      <FormField id={`${idPrefix}-doc`} label="Doc link (optional)" error={urlError} hint="Feedback doc, recording or sheet">
        <Input id={`${idPrefix}-doc`} type="url" className="bg-white" value={value.docUrl} placeholder="https://docs.google.com/…" onChange={(event) => onChange({ ...value, docUrl: event.target.value })} />
      </FormField>
    </div>
  );
}

/** Add, rename or remove reasons. Removing only hides a reason from the dropdown. */
export function ManageReasonsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const reasons = useRejectionReasons();
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: REASONS_KEY });
  const create = useMutation({ mutationFn: () => rejectionReasonsApi.create(newLabel), onSuccess: async () => { setNewLabel(""); await refresh(); } });
  const rename = useMutation({ mutationFn: (target: { id: string; label: string }) => rejectionReasonsApi.rename(target.id, target.label), onSuccess: async () => { setEditing(null); await refresh(); } });
  const remove = useMutation({ mutationFn: (reason: RejectionReason) => rejectionReasonsApi.remove(reason.id), onSuccess: async (_, reason) => { toast.success(`Removed “${reason.label}”`); await refresh(); } });
  const live = (reasons.data ?? []).filter((reason) => !reason.archivedAt);
  const error = create.error ?? rename.error ?? remove.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Company rejection reasons</DialogTitle>
          <DialogDescription>The list the team picks from when a company rejects a student. Removing a reason hides it from the list; results already tagged keep it.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={newLabel} maxLength={80} placeholder="New reason, e.g. Weak in SQL" onChange={(event) => setNewLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && newLabel.trim().length >= 2) create.mutate(); }} />
          <Button disabled={newLabel.trim().length < 2 || create.isPending} onClick={() => create.mutate()}><Plus size={14} /> Add</Button>
        </div>
        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {live.map((reason) => (
            <li key={reason.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === reason.id ? (
                <>
                  <Input autoFocus className="h-8" value={editing.label} maxLength={80} onChange={(event) => setEditing({ id: reason.id, label: event.target.value })}
                    onKeyDown={(event) => { if (event.key === "Enter" && editing.label.trim().length >= 2) rename.mutate(editing); }} />
                  <Button size="sm" className="h-8" disabled={editing.label.trim().length < 2 || rename.isPending} onClick={() => rename.mutate(editing)}><Check size={13} /></Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}><X size={13} /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1">{reason.label}</span>
                  {reason.builtIn && <span className="text-[10px] uppercase tracking-wide text-slate-400">Standard</span>}
                  <span className="w-16 text-right text-xs text-slate-400">{reason.inUse ? `${reason.inUse} used` : ""}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Rename ${reason.label}`} onClick={() => setEditing({ id: reason.id, label: reason.label })}><Pencil size={13} /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" aria-label={`Remove ${reason.label}`} disabled={remove.isPending} onClick={() => remove.mutate(reason)}><Trash2 size={13} /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-rose-600">{error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
