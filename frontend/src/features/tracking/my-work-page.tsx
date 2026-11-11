import { useQuery } from "@tanstack/react-query";
import { SCREENING_SKIP_REASON_LABELS } from "@placement/shared";
import { format } from "date-fns";
import { Award, BriefcaseBusiness, GraduationCap, Handshake, ListChecks, Pencil, Send, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useAuth } from "../../contexts/auth-context";
import { trackingApi } from "../../services/tracking-api";
import type { MyWorkJob } from "../../types/tracking";
import { JobStatusBadge } from "../job-requests/job-status-badge";
import { ProcessBadge, ProcessStatusDialog, RecordGuidanceDialog } from "./tracking-dialogs";

const ACTIVE = ["DRAFT", "OPEN", "ON_HOLD"];
const day = (value: string) => format(new Date(value), "d MMM");

function Num({ value, tone }: { value: number; tone?: "amber" | "emerald" | "rose" }) {
  if (value === 0) return <span className="text-slate-300">0</span>;
  const color = tone === "amber" ? "font-semibold text-amber-700" : tone === "emerald" ? "font-semibold text-emerald-700" : tone === "rose" ? "text-rose-600" : "text-slate-700";
  return <span className={color}>{value}</span>;
}

export function MyWorkPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const ownerId = params.get("owner") ?? undefined;
  const [activeOnly, setActiveOnly] = useState(true);
  const [editing, setEditing] = useState<MyWorkJob | null>(null);
  const [recording, setRecording] = useState(false);
  const work = useQuery({ queryKey: ["my-work", ownerId ?? "me"], queryFn: () => trackingApi.myWork(ownerId) });
  const jobs = useMemo(() => (work.data?.jobs ?? []).filter((job) => !activeOnly || ACTIVE.includes(job.status) || job.counts.inProcess > 0), [work.data, activeOnly]);

  if (work.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (work.error) return <Card><ErrorState error={work.error} onRetry={() => void work.refetch()} /></Card>;
  const { totals, owner, owners, canEdit, guidanceGivenElsewhere } = work.data;
  const isMe = owner.id === user?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isMe ? "My workspace" : "PSM workspace"}
        title={isMe ? "My companies" : owner.fullName}
        description="Companies you shortlisted for: company process status, who was shared, selects from the company sheets, and guidance."
        actions={(
          <>
            {owners.length > 0 && (
              <Select value={ownerId ?? user?.id ?? ""} onValueChange={(value) => setParams(value === user?.id ? {} : { owner: value })}>
                <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Choose a PSM" /></SelectTrigger>
                <SelectContent>{owners.map((option) => <SelectItem key={option.id} value={option.id}>{option.fullName}{option.id === user?.id ? " (me)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {canEdit && <Button size="sm" variant="outline" onClick={() => setRecording(true)}><GraduationCap size={14} /> Record guidance I gave</Button>}
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Active jobs" value={totals.activeJobs} hint={`${totals.jobs} in total`} icon={BriefcaseBusiness} />
        <KpiCard label="Final shortlist (SP)" value={totals.finalShortlisted} icon={ListChecks} tone="sky" />
        <KpiCard label="Shared with company" value={totals.shared} icon={Send} tone="sky" />
        <KpiCard label="Not shared after SP" value={totals.notShared} icon={UserX} tone="amber" />
        <KpiCard label="Selects" value={totals.selected} hint={`${totals.offers} offers · ${totals.joined} joined`} icon={Award} tone="emerald" />
        <KpiCard label="In company process" value={totals.inProcess} icon={Handshake} tone="slate" />
        <KpiCard label="Guidance pending" value={totals.guidancePending} hint="shared, no guidance yet" icon={GraduationCap} tone={totals.guidancePending > 0 ? "rose" : "slate"} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Companies ({jobs.length})</p>
          <label className="flex items-center gap-2 text-xs text-slate-500"><Checkbox checked={activeOnly} onCheckedChange={(checked) => setActiveOnly(checked === true)} /> Active jobs only</label>
        </div>
        {jobs.length === 0 ? (
          <EmptyState icon={BriefcaseBusiness} title="No jobs" description={activeOnly ? "No active jobs. Clear “Active jobs only” to see closed ones." : "No job requests are assigned yet."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Company / role</th>
                  <th className="px-3 py-2">Company status</th>
                  <th className="px-3 py-2 text-right">TA</th>
                  <th className="px-3 py-2 text-right" title="Rejected at RS, SC or AS">Int. rejected</th>
                  <th className="px-3 py-2 text-right">SP</th>
                  <th className="px-3 py-2 text-right">Shared</th>
                  <th className="px-3 py-2 text-right">Not shared</th>
                  <th className="px-3 py-2 text-right">In process</th>
                  <th className="px-3 py-2 text-right">Co. rejected</th>
                  <th className="px-3 py-2 text-right">Selects</th>
                  <th className="px-3 py-2 text-right">Offers / joined</th>
                  <th className="px-4 py-2">Guidance</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5">
                      <Link to={`/job-requests/${job.id}?tab=pipeline`} className="font-medium text-slate-800 hover:text-indigo-700">{job.company.name}</Link>
                      <p className="text-xs text-slate-500">{job.roleTitle}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <JobStatusBadge status={job.status} />
                        {job.screeningSkipped && (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700" title={job.screeningSkipped.note ?? undefined}>
                            Screening skipped{job.screeningSkipped.reason ? ` · ${SCREENING_SKIP_REASON_LABELS[job.screeningSkipped.reason]}` : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <ProcessBadge phase={job.processPhase} label={job.processLabel} />
                        {canEdit && isMe && <Button size="icon-sm" variant="ghost" aria-label="Update company status" onClick={() => setEditing(job)}><Pencil size={12} /></Button>}
                      </div>
                      {job.processPhaseAt && <p className="mt-0.5 text-[11px] text-slate-400">since {day(job.processPhaseAt)}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.applications} /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.internalRejected} tone="rose" /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.finalShortlisted} /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.shared} /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.notShared} tone="amber" /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.inProcess} /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.rejectedByCompany} tone="rose" /></td>
                    <td className="px-3 py-2.5 text-right"><Num value={job.counts.selected} tone="emerald" /></td>
                    <td className="px-3 py-2.5 text-right text-xs text-slate-600">{job.counts.offers} / {job.counts.joined}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {job.guidance.sessions > 0 || job.counts.studentsGuided > 0 ? (
                        <Link to={`/guidance/${job.id}`} className="text-emerald-700 hover:underline">
                          Done{job.guidance.givers.length ? ` · ${job.guidance.givers.join(", ")}` : ""}{job.guidance.last ? ` · ${day(job.guidance.last.givenOn)}` : ""}
                          {job.counts.studentsGuided > 0 && <span className="block text-slate-500">{job.counts.studentsGuided} individually</span>}
                        </Link>
                      ) : (
                        <Link to={`/guidance/${job.id}`} className={job.counts.shared > 0 ? "font-medium text-rose-600 hover:underline" : "text-slate-400 hover:underline"}>
                          {job.counts.shared > 0 ? "Pending" : "Not yet"}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Guidance {isMe ? "I gave" : `${owner.fullName} gave`} on other PSMs' jobs ({guidanceGivenElsewhere.length})</p>
        </div>
        {guidanceGivenElsewhere.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-400">None recorded. Use “Record guidance I gave” to add guidance for a job owned by someone else.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {guidanceGivenElsewhere.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <Link to={`/guidance/${session.jobRequest.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{session.jobRequest.company.name} · {session.jobRequest.roleTitle}</Link>
                  <span className="text-xs text-slate-500"> · owner {session.jobRequest.psmOwner?.fullName ?? "unassigned"}{session.notes ? ` · ${session.notes}` : ""}</span>
                </span>
                <span className="text-xs text-slate-500">{day(session.givenOn)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <ProcessStatusDialog
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
          job={{ id: editing.id, roleTitle: editing.roleTitle, companyName: editing.company.name, phase: editing.processPhase, roundId: editing.processRound?.id ?? null, rounds: editing.rounds }}
        />
      )}
      <RecordGuidanceDialog open={recording} onOpenChange={setRecording} />
    </div>
  );
}
