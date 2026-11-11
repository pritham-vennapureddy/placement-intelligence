import { STUDENT_SUPPORT_KIND_LABELS, type StudentSupportKind } from "@placement/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, GraduationCap, ListChecks, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../contexts/auth-context";
import { guidanceApi } from "../../services/tracking-api";
import type { GuidanceView, StudentSupportInput, SupportStatusOption } from "../../types/tracking";
import { ManageStatusesDialog, NOT_RECORDED, SupportBadge, SupportCell, SupportDialog } from "./student-support";
import { CompanyStatusCell, RecordGuidanceDialog, useTrackingRefresh } from "./tracking-dialogs";

const day = (value: string) => format(new Date(value), "d MMM yyyy");
const KINDS: StudentSupportKind[] = ["GUIDANCE", "RSA"];
const fieldOf = (kind: StudentSupportKind) => (kind === "GUIDANCE" ? "guidance" : "rsa");

type Student = GuidanceView["students"][number];
type Editing = { kind: StudentSupportKind; applicationIds: string[]; presetStatusId?: string | undefined } | null;

/** "Guidance: Done 12 · Scheduled 3 · Not recorded 5", in the list's order (deleted statuses last). */
function StatusSummary({ kind, students, options }: { kind: StudentSupportKind; students: Student[]; options: SupportStatusOption[] }) {
  const counts = new Map<string, number>();
  for (const student of students) {
    const key = student[fieldOf(kind)]?.status.id ?? NOT_RECORDED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = options.filter((option) => option.kind === kind).sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{STUDENT_SUPPORT_KIND_LABELS[kind]}:</span>
      {ordered.filter((option) => counts.get(option.id)).map((option) => (
        <span key={option.id} className="inline-flex items-center gap-1"><SupportBadge label={option.label} tone={option.tone} deleted={Boolean(option.archivedAt)} /><span className="text-xs text-slate-500">{counts.get(option.id)}</span></span>
      ))}
      {counts.get(NOT_RECORDED) ? <span className="text-xs text-slate-400">Not recorded {counts.get(NOT_RECORDED)}</span> : null}
    </div>
  );
}

export function GuidancePage() {
  const { jobRequestId = "" } = useParams();
  const { user } = useAuth();
  const refresh = useTrackingRefresh();
  const [recording, setRecording] = useState(false);
  const [onlyShared, setOnlyShared] = useState(false);
  const [allApplicants, setAllApplicants] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<{ kind: StudentSupportKind; status: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [managing, setManaging] = useState(false);
  const view = useQuery({
    queryKey: ["guidance", "job", jobRequestId, allApplicants ? "all" : "shortlisted"],
    queryFn: () => guidanceApi.forJob(jobRequestId, allApplicants ? "all" : "shortlisted"),
  });
  const run = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message),
  });

  const students = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (view.data?.students ?? []).filter((student) =>
      (!onlyShared || student.shareStatus === "SHARED")
      && (!q || student.candidate.fullName.toLowerCase().includes(q) || student.candidate.candidateCode.toLowerCase().includes(q))
      && (!filter || (student[fieldOf(filter.kind)]?.status.id ?? NOT_RECORDED) === filter.status));
  }, [view.data, onlyShared, search, filter]);

  if (view.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (view.error) return <Card><ErrorState error={view.error} onRetry={() => void view.refetch()} /></Card>;
  const { job, sessions, people, canEdit, statusOptions } = view.data;
  const byId = new Map(view.data.students.map((student) => [student.id, student]));
  const visibleIds = students.map(({ id }) => id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedIds = [...selected].filter((id) => byId.has(id));
  const toggleRow = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const quickSave = (applicationId: string, kind: StudentSupportKind, input: StudentSupportInput) =>
    run.mutate(() => guidanceApi.setSupport(applicationId, kind, input));
  const clear = (applicationId: string, kind: StudentSupportKind) => run.mutate(() => guidanceApi.clearSupport(applicationId, kind));

  return (
    <div className="space-y-6">
      <Link to="/my-work" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> My work</Link>
      <PageHeader
        eyebrow={job.company.name}
        title={`Guidance & RSA · ${job.roleTitle}`}
        description={<>Owner {job.psmOwner?.fullName ?? "unassigned"} · Company status: {job.processLabel}</>}
        actions={canEdit && (
          <>
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}><ListChecks size={14} /> Manage statuses</Button>
            <Button size="sm" onClick={() => setRecording(true)}><GraduationCap size={14} /> I gave a drive session</Button>
          </>
        )}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-semibold text-slate-800">Drive sessions ({sessions.length})</p></div>
        {sessions.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No session recorded" description="Whoever gave the guidance records it here under their own name. To mark the students who attended, select them below and use Set Guidance." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <div>
                  <p><span className="font-medium text-slate-800">{session.givenBy.fullName}</span> · {day(session.givenOn)}</p>
                  {session.notes && <p className="text-xs text-slate-500">{session.notes}</p>}
                </div>
                {session.canDelete && (
                  <Button size="icon-sm" variant="ghost" aria-label="Remove session" disabled={run.isPending} onClick={() => run.mutate(() => guidanceApi.deleteSession(session.id))}><Trash2 size={13} /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{allApplicants ? "All applicants" : "Shortlisted students"} ({view.data.students.length})</p>
              <p className="text-xs text-slate-400">Pick a status from the dropdown; it saves straight away. Use the pencil for contributors, date and note. RSA = rejection section analysis.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or ID" className="h-8 w-44" />
              <select
                aria-label="Filter by status"
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                value={filter ? `${filter.kind}:${filter.status}` : ""}
                onChange={(event) => {
                  const [kind, status] = event.target.value.split(":");
                  setFilter(kind && status ? { kind: kind as StudentSupportKind, status } : null);
                }}
              >
                <option value="">All statuses</option>
                {KINDS.map((kind) => (
                  <optgroup key={kind} label={STUDENT_SUPPORT_KIND_LABELS[kind]}>
                    <option value={`${kind}:${NOT_RECORDED}`}>{STUDENT_SUPPORT_KIND_LABELS[kind]}: not recorded</option>
                    {statusOptions.filter((option) => option.kind === kind).map((option) => <option key={option.id} value={`${kind}:${option.id}`}>{STUDENT_SUPPORT_KIND_LABELS[kind]}: {option.label}{option.archivedAt ? " (deleted)" : ""}</option>)}
                  </optgroup>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-500"><Checkbox checked={onlyShared} onCheckedChange={(checked) => setOnlyShared(checked === true)} /> Only shared with company</label>
              <label className="flex items-center gap-2 text-xs text-slate-500" title="Include applicants who were not shortlisted, e.g. for RSA"><Checkbox checked={allApplicants} onCheckedChange={(checked) => { setAllApplicants(checked === true); setSelected(new Set()); }} /> All applicants</label>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {KINDS.map((kind) => <StatusSummary key={kind} kind={kind} students={view.data.students} options={statusOptions} />)}
          </div>
          {canEdit && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
              <span className="text-xs font-medium text-indigo-800">{selectedIds.length} selected</span>
              {KINDS.map((kind) => (
                <Button key={kind} size="sm" variant="outline" onClick={() => setEditing({ kind, applicationIds: selectedIds })}>Set {STUDENT_SUPPORT_KIND_LABELS[kind]}…</Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
          )}
        </div>
        {students.length === 0 ? (
          <EmptyState
            title="No students"
            description={view.data.students.length ? "No one matches these filters." : allApplicants ? "No applicants yet." : "Students appear here once they are selected at SP or nominated. Tick “All applicants” to work with everyone."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  {canEdit && (
                    <th className="w-10 px-4 py-2">
                      <Checkbox
                        aria-label="Select all shown"
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => setSelected((current) => {
                          const next = new Set(current);
                          for (const id of visibleIds) if (checked === true) next.add(id); else next.delete(id);
                          return next;
                        })}
                      />
                    </th>
                  )}
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">With company</th>
                  <th className="px-3 py-2">Guidance</th>
                  <th className="px-3 py-2" title="Rejection section analysis">RSA</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className={selected.has(student.id) ? "border-t border-slate-100 bg-indigo-50/40 align-top" : "border-t border-slate-100 align-top"}>
                    {canEdit && <td className="px-4 py-2"><Checkbox aria-label={`Select ${student.candidate.fullName}`} checked={selected.has(student.id)} onCheckedChange={() => toggleRow(student.id)} /></td>}
                    <td className="px-3 py-2">
                      <Link to={`/candidates/${student.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{student.candidate.fullName}</Link>
                      <p className="font-mono text-[10px] text-slate-400">{student.candidate.candidateCode}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{student.product?.name ?? "—"}</td>
                    <td className="px-3 py-2"><CompanyStatusCell shareStatus={student.shareStatus} pipelineStatus={student.pipelineStatus} /></td>
                    {KINDS.map((kind) => (
                      <td key={kind} className="px-3 py-2">
                        <SupportCell
                          kind={kind}
                          support={student[fieldOf(kind)]}
                          options={statusOptions}
                          canEdit={canEdit}
                          meId={user?.id}
                          saving={run.isPending}
                          onQuickSave={(input) => quickSave(student.id, kind, input)}
                          onClear={() => clear(student.id, kind)}
                          onOpenDetails={(presetStatusId) => setEditing({ kind, applicationIds: [student.id], presetStatusId })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <SupportDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          kind={editing.kind}
          jobRequestId={job.id}
          targets={editing.applicationIds.flatMap((id) => {
            const student = byId.get(id);
            return student ? [{ applicationId: id, name: student.candidate.fullName, support: student[fieldOf(editing.kind)] }] : [];
          })}
          people={people}
          options={statusOptions}
          meId={user?.id}
          presetStatusId={editing.presetStatusId}
          onSaved={async () => {
            if (editing.applicationIds.length > 1) setSelected(new Set());
            await refresh();
          }}
        />
      )}
      <ManageStatusesDialog open={managing} onOpenChange={setManaging} />
      <RecordGuidanceDialog open={recording} onOpenChange={setRecording} job={{ id: job.id, label: `${job.company.name} · ${job.roleTitle}` }} />
    </div>
  );
}
