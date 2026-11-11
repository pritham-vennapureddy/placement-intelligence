import {
  STUDENT_SUPPORT_KIND_DESCRIPTIONS,
  STUDENT_SUPPORT_KIND_LABELS,
  SUPPORT_TONES,
  type StudentSupportKind,
  type SupportTone,
} from "@placement/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { guidanceApi } from "../../services/tracking-api";
import type { PersonOption, StudentSupport, StudentSupportInput, SupportStatusOption } from "../../types/tracking";
import { cn } from "../../utils/cn";

export const NOT_RECORDED = "__none__";
const today = () => format(new Date(), "yyyy-MM-dd");

/** Badge / dropdown colours for each tone a status can use. */
export const TONE_CLASSES: Record<SupportTone, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
};
const toneClass = (tone: string) => TONE_CLASSES[tone as SupportTone] ?? TONE_CLASSES.slate;

/** Every contributor's name: team members first, then names typed under Others. */
export function contributorNames(support: Pick<StudentSupport, "contributors" | "otherContributors">): string[] {
  return [...support.contributors.map(({ fullName }) => fullName), ...(support.otherContributors ? [support.otherContributors] : [])];
}

export function SupportBadge({ label, tone, deleted = false }: { label: string; tone: string; deleted?: boolean }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", toneClass(tone))} title={deleted ? "This status was deleted from the list" : undefined}>
      {label}{deleted && " (deleted)"}
    </Badge>
  );
}

/** Live statuses for a task, plus the student's current one if it was deleted since. */
export function optionsFor(all: SupportStatusOption[], kind: StudentSupportKind, current?: StudentSupport | null) {
  const live = all.filter((option) => option.kind === kind && !option.archivedAt);
  const kept = current && current.status.archivedAt ? all.find(({ id }) => id === current.status.id) : undefined;
  return kept ? [...live, kept] : live;
}

/** What a quick dropdown change saves: keep what is already recorded, fill sensible defaults. */
export function quickInput(option: SupportStatusOption, current: StudentSupport | null, meId: string | undefined): StudentSupportInput {
  const contributorIds = current?.contributors.map(({ id }) => id) ?? [];
  const needsPerson = option.needsContributor && contributorIds.length === 0 && !current?.otherContributors;
  return {
    statusId: option.id,
    contributorIds: needsPerson && meId ? [meId] : contributorIds,
    otherContributors: current?.otherContributors ?? null,
    doneOn: current?.doneOn?.slice(0, 10) ?? (option.countsAsDone || option.needsContributor ? today() : null),
    notes: current?.notes ?? null,
  };
}

/**
 * Status dropdown for one student's Guidance or RSA. Most changes save at once;
 * a status that still needs a note or a name opens the details dialog.
 */
export function SupportCell({
  kind,
  support,
  options,
  canEdit,
  meId,
  saving,
  onQuickSave,
  onClear,
  onOpenDetails,
}: {
  kind: StudentSupportKind;
  support: StudentSupport | null;
  options: SupportStatusOption[];
  canEdit: boolean;
  meId: string | undefined;
  saving: boolean;
  onQuickSave: (input: StudentSupportInput) => void;
  onClear: () => void;
  onOpenDetails: (presetStatusId?: string) => void;
}) {
  const names = support ? contributorNames(support) : [];
  const detail = [names.join(", "), support?.doneOn ? format(new Date(support.doneOn), "d MMM") : null].filter(Boolean).join(" · ");
  if (!canEdit) {
    return support
      ? <div className="space-y-0.5"><SupportBadge label={support.status.label} tone={support.status.tone} deleted={Boolean(support.status.archivedAt)} />{detail && <p className="text-[10px] text-slate-500">{detail}</p>}</div>
      : <span className="text-xs text-slate-300">Not recorded</span>;
  }
  const choices = optionsFor(options, kind, support);
  return (
    <div className="min-w-[150px] space-y-1">
      <div className="flex items-center gap-1">
        <select
          aria-label={`${STUDENT_SUPPORT_KIND_LABELS[kind]} status`}
          disabled={saving}
          value={support?.status.id ?? NOT_RECORDED}
          onChange={(event) => {
            const value = event.target.value;
            if (value === NOT_RECORDED) return onClear();
            const option = choices.find(({ id }) => id === value);
            if (!option) return;
            const input = quickInput(option, support, meId);
            const missingPerson = option.needsContributor && input.contributorIds.length === 0 && !input.otherContributors;
            if ((option.needsNote && !input.notes) || missingPerson) return onOpenDetails(option.id);
            onQuickSave(input);
          }}
          className={cn(
            "h-8 w-full rounded-md border px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-200",
            support ? toneClass(support.status.tone) : "border-slate-200 bg-white text-slate-400",
          )}
        >
          <option value={NOT_RECORDED}>Not recorded</option>
          {choices.map((option) => <option key={option.id} value={option.id}>{option.label}{option.archivedAt ? " (deleted)" : ""}</option>)}
        </select>
        <Button size="icon-sm" variant="ghost" aria-label={`${STUDENT_SUPPORT_KIND_LABELS[kind]} details`} title="Contributors, date and note" onClick={() => onOpenDetails()}>
          <Pencil size={12} />
        </Button>
      </div>
      {detail && <p className="text-[10px] leading-snug text-slate-500">{detail}</p>}
      {support?.notes && <p className="line-clamp-2 text-[10px] italic leading-snug text-slate-400" title={support.notes}>{support.notes}</p>}
    </div>
  );
}

/**
 * Full editor for Guidance or RSA: status, any number of team contributors,
 * outside names, date and note. Used for one student or for a selection.
 */
export function SupportDialog({
  open,
  onOpenChange,
  kind,
  jobRequestId,
  targets,
  people,
  options,
  meId,
  presetStatusId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StudentSupportKind;
  jobRequestId: string;
  /** One student (edits their record) or several (applies the same values to all). */
  targets: { applicationId: string; name: string; support: StudentSupport | null }[];
  people: PersonOption[];
  options: SupportStatusOption[];
  meId: string | undefined;
  presetStatusId?: string | undefined;
  onSaved: () => Promise<unknown> | void;
}) {
  const single = targets.length === 1 ? targets[0] : null;
  const choices = optionsFor(options, kind, single?.support);
  const [statusId, setStatusId] = useState("");
  const [contributorIds, setContributorIds] = useState<string[]>([]);
  const [others, setOthers] = useState("");
  const [doneOn, setDoneOn] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const current = single?.support ?? null;
    const first = choices.find((option) => option.countsAsDone) ?? choices[0];
    const nextId = presetStatusId ?? current?.status.id ?? first?.id ?? "";
    const next = choices.find(({ id }) => id === nextId);
    setStatusId(nextId);
    const ids = current?.contributors.map(({ id }) => id) ?? [];
    setContributorIds(ids.length || current?.otherContributors ? ids : meId ? [meId] : []);
    setOthers(current?.otherContributors ?? "");
    setDoneOn(current?.doneOn?.slice(0, 10) ?? (next?.countsAsDone || next?.needsContributor ? today() : ""));
    setNotes(current?.notes ?? "");
    setSearch("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = choices.find(({ id }) => id === statusId);
  const needsPerson = Boolean(status?.needsContributor) && contributorIds.length === 0 && !others.trim();
  const needsNote = Boolean(status?.needsNote) && !notes.trim();
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? people.filter(({ fullName }) => fullName.toLowerCase().includes(q)) : people;
    // Selected people stay visible even when the search hides them.
    const hiddenSelected = people.filter((person) => contributorIds.includes(person.id) && !list.includes(person));
    return [...hiddenSelected, ...list];
  }, [people, search, contributorIds]);

  const save = useMutation({
    mutationFn: async () => {
      const input: StudentSupportInput = {
        statusId,
        contributorIds,
        otherContributors: others.trim() || null,
        doneOn: doneOn || null,
        notes: notes.trim() || null,
      };
      if (single) await guidanceApi.setSupport(single.applicationId, kind, input);
      else await guidanceApi.bulkSupport(jobRequestId, kind, targets.map(({ applicationId }) => applicationId), input);
    },
    onSuccess: async () => {
      await onSaved();
      toast.success(single ? `${STUDENT_SUPPORT_KIND_LABELS[kind]} updated` : `${STUDENT_SUPPORT_KIND_LABELS[kind]} updated for ${targets.length} students`);
      onOpenChange(false);
    },
  });

  const toggle = (id: string) => setContributorIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{STUDENT_SUPPORT_KIND_LABELS[kind]}{single ? ` · ${single.name}` : ` · ${targets.length} students`}</DialogTitle>
          <DialogDescription>
            {STUDENT_SUPPORT_KIND_DESCRIPTIONS[kind]}. {single ? "Record where it stands and everyone who contributed." : "The same status, contributors, date and note are saved for every selected student, replacing what they had."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="support-status" label="Status" required>
            <select id="support-status" value={statusId} onChange={(event) => setStatusId(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
              {choices.map((option) => <option key={option.id} value={option.id}>{option.label}{option.archivedAt ? " (deleted)" : ""}</option>)}
            </select>
          </FormField>

          <FormField id="support-people" label={`Contributed by${status?.needsContributor ? "" : " (optional)"}`}>
            <Input id="support-people" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the team…" className="h-9" />
            <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200 p-1">
              {shown.length === 0 && <p className="px-2 py-2 text-xs text-slate-400">No one matches.</p>}
              {shown.map((person) => (
                <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <Checkbox checked={contributorIds.includes(person.id)} onCheckedChange={() => toggle(person.id)} />
                  {person.fullName}{person.id === meId && <span className="text-[10px] text-slate-400">(you)</span>}
                </label>
              ))}
            </div>
            {contributorIds.length > 0 && <p className="mt-1 text-[11px] text-slate-500">{contributorIds.length} selected</p>}
          </FormField>

          <FormField id="support-others" label="Others (people without an account)">
            <Input id="support-others" maxLength={300} value={others} onChange={(event) => setOthers(event.target.value)} placeholder="e.g. Ravi (trainer), alumni panel" />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="support-date" label="Date">
              <Input id="support-date" type="date" max={today()} value={doneOn} onChange={(event) => setDoneOn(event.target.value)} />
            </FormField>
          </div>

          <FormField id="support-notes" label={`Note${status?.needsNote ? "" : " (optional)"}`} required={Boolean(status?.needsNote)}>
            <Textarea id="support-notes" rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. went through the SC rejection with the student; weak on SQL joins" />
          </FormField>
        </div>
        {needsPerson && <p className="text-xs text-amber-700">“{status?.label}” needs who contributed. Pick a team member or type a name under Others.</p>}
        {needsNote && <p className="text-xs text-amber-700">“{status?.label}” needs a note.</p>}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !statusId || needsPerson || needsNote}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Draft = { label: string; tone: SupportTone; countsAsDone: boolean; needsContributor: boolean; needsNote: boolean };
const EMPTY_DRAFT: Draft = { label: "", tone: "slate", countsAsDone: false, needsContributor: false, needsNote: false };

function ToneChoice({ value, onChange }: { value: SupportTone; onChange: (tone: SupportTone) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      {SUPPORT_TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={tone}
          title={tone}
          onClick={() => onChange(tone)}
          className={cn("h-6 w-6 rounded-full border-2", TONE_CLASSES[tone], value === tone ? "ring-2 ring-indigo-500 ring-offset-1" : "")}
        />
      ))}
    </div>
  );
}

function RuleSwitches({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const rules = [
    ["countsAsDone", "Counts as done", "Shown as completed in My work and job summaries"],
    ["needsContributor", "Needs who contributed", "A team member or an outside name is required"],
    ["needsNote", "Needs a note", "An explanation is required"],
  ] as const;
  return (
    <div className="grid gap-1.5">
      {rules.map(([key, label, hint]) => (
        <label key={key} className="flex items-start gap-2 text-xs text-slate-700">
          <Checkbox checked={draft[key]} onCheckedChange={(checked) => onChange({ ...draft, [key]: checked === true })} className="mt-0.5" />
          <span><span className="font-medium">{label}</span> <span className="text-slate-400">· {hint}</span></span>
        </label>
      ))}
    </div>
  );
}

/** Add, rename, recolour, reorder and delete the Guidance / RSA statuses. */
export function ManageStatusesDialog({ open, onOpenChange, initialKind = "GUIDANCE" }: { open: boolean; onOpenChange: (open: boolean) => void; initialKind?: StudentSupportKind }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<StudentSupportKind>(initialKind);
  const [adding, setAdding] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  useEffect(() => { if (open) { setKind(initialKind); setAdding(EMPTY_DRAFT); setEditingId(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({ queryKey: ["guidance", "status-options"], queryFn: guidanceApi.statusOptions, enabled: open });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["guidance"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["my-work"] }),
  ]);
  const run = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message),
  });

  const all = (list.data ?? []).filter((option) => option.kind === kind);
  const live = all.filter((option) => !option.archivedAt);
  const deleted = all.filter((option) => option.archivedAt);
  const move = (index: number, by: -1 | 1) => {
    const ids = live.map(({ id }) => id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    run.mutate(() => guidanceApi.reorderStatusOptions(kind, ids));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !run.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage statuses</DialogTitle>
          <DialogDescription>These are the choices in the Guidance and RSA dropdowns, shared by the whole team. Deleting a status that students already have hides it from the dropdown but keeps it on their records.</DialogDescription>
        </DialogHeader>
        <Tabs value={kind} onValueChange={(value) => { setKind(value as StudentSupportKind); setEditingId(null); }}>
          <TabsList>
            <TabsTrigger value="GUIDANCE">Guidance</TabsTrigger>
            <TabsTrigger value="RSA">RSA · rejection section analysis</TabsTrigger>
          </TabsList>
        </Tabs>

        {list.isPending ? <p className="py-6 text-center text-sm text-slate-400">Loading…</p> : list.error ? <p role="alert" className="text-sm text-rose-600">{list.error.message}</p> : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {live.map((option, index) => (
              <div key={option.id} className="px-3 py-2">
                {editingId === option.id ? (
                  <form
                    className="grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run.mutate(async () => { await guidanceApi.updateStatusOption(option.id, { ...editDraft, label: editDraft.label.trim() }); setEditingId(null); });
                    }}
                  >
                    <Input autoFocus required maxLength={60} value={editDraft.label} onChange={(event) => setEditDraft({ ...editDraft, label: event.target.value })} className="h-9" />
                    <ToneChoice value={editDraft.tone} onChange={(tone) => setEditDraft({ ...editDraft, tone })} />
                    <RuleSwitches draft={editDraft} onChange={setEditDraft} />
                    <div className="flex gap-2">
                      <Button size="sm" type="submit" disabled={run.isPending || !editDraft.label.trim()}>Save</Button>
                      <Button size="sm" type="button" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <SupportBadge label={option.label} tone={option.tone} />
                      <span className="text-[10px] text-slate-400">
                        {[option.countsAsDone && "counts as done", option.needsContributor && "needs contributor", option.needsNote && "needs note", option.inUse ? `${option.inUse} students` : null].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={run.isPending || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={run.isPending || index === live.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${option.label}`} onClick={() => { setEditingId(option.id); setEditDraft({ label: option.label, tone: option.tone, countsAsDone: option.countsAsDone, needsContributor: option.needsContributor, needsNote: option.needsNote }); }}><Pencil size={13} /></Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${option.label}`}
                        className="text-rose-600 hover:text-rose-700"
                        disabled={run.isPending || live.length <= 1}
                        title={live.length <= 1 ? "Keep at least one status" : undefined}
                        onClick={() => run.mutate(async () => {
                          const result = await guidanceApi.deleteStatusOption(option.id);
                          toast.success(result.removed ? `“${option.label}” deleted` : `“${option.label}” removed from the list; ${result.keptOnStudents} students keep it`);
                        })}
                      ><Trash2 size={13} /></Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <form
          className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate(async () => {
              await guidanceApi.createStatusOption({ kind, ...adding, label: adding.label.trim() });
              setAdding(EMPTY_DRAFT);
              toast.success("Status added");
            });
          }}
        >
          <p className="text-xs font-semibold text-slate-600">Add a {STUDENT_SUPPORT_KIND_LABELS[kind]} status</p>
          <div className="flex gap-2">
            <Input maxLength={60} value={adding.label} onChange={(event) => setAdding({ ...adding, label: event.target.value })} placeholder={kind === "RSA" ? "e.g. Analysis shared with student" : "e.g. Mock interview done"} className="h-9" />
            <Button type="submit" size="sm" disabled={run.isPending || !adding.label.trim()}><Plus size={14} /> Add</Button>
          </div>
          <ToneChoice value={adding.tone} onChange={(tone) => setAdding({ ...adding, tone })} />
          <RuleSwitches draft={adding} onChange={setAdding} />
        </form>

        {deleted.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">Deleted (still on some students)</p>
            <div className="flex flex-wrap gap-2">
              {deleted.map((option) => (
                <span key={option.id} className="inline-flex items-center gap-1">
                  <SupportBadge label={option.label} tone={option.tone} />
                  <span className="text-[10px] text-slate-400">{option.inUse} students</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Restore ${option.label}`} title="Restore" disabled={run.isPending} onClick={() => run.mutate(() => guidanceApi.updateStatusOption(option.id, { restore: true }))}><RotateCcw size={12} /></Button>
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={run.isPending}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
