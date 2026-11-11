import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { GraduationCap, History, Pencil, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { trackingApi } from "../../services/tracking-api";
import { ProcessBadge, ProcessStatusDialog, RecordGuidanceDialog } from "./tracking-dialogs";

const day = (value: string) => format(new Date(value), "d MMM yyyy");

export function JobTrackingPanel({ jobRequestId, roleTitle, companyName, rounds }: {
  jobRequestId: string;
  roleTitle: string;
  companyName: string;
  rounds: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const tracking = useQuery({ queryKey: ["tracking", jobRequestId], queryFn: () => trackingApi.job(jobRequestId) });

  if (tracking.isPending) return <Card><LoadingRows rows={2} /></Card>;
  if (tracking.error) return <Card><ErrorState error={tracking.error} onRetry={() => void tracking.refetch()} /></Card>;
  const { process, guidance, notShared, canEdit } = tracking.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">Company process status</p>
              <p className="text-xs text-slate-400">{process.updatedAt ? `Updated ${day(process.updatedAt)}` : "Not updated yet"}</p>
            </div>
            <div className="flex gap-1">
              {process.history.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowHistory((value) => !value)}><History size={14} /> History</Button>}
              {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil size={14} /> Update</Button>}
            </div>
          </div>
          <ProcessBadge phase={process.phase} label={process.label} />
          {showHistory && (
            <ol className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
              {process.history.map((entry) => (
                <li key={entry.id}>
                  <span className="font-medium text-slate-800">{entry.label}</span> · {day(entry.changedAt)}{entry.changedBy ? ` · ${entry.changedBy.fullName}` : ""}
                  {entry.notes && <span className="text-slate-400"> · “{entry.notes}”</span>}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">Guidance</p>
              <p className="text-xs text-slate-400">
                {guidance.sessions.length === 0 ? "No drive session recorded" : `${guidance.sessions.length} session${guidance.sessions.length > 1 ? "s" : ""}`}
                {guidance.studentsGuided > 0 && ` · ${guidance.studentsGuided} students guided individually`}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" asChild><Link to={`/guidance/${jobRequestId}`}>Guidance &amp; RSA</Link></Button>
              {canEdit && <Button size="sm" variant="outline" onClick={() => setRecording(true)}><GraduationCap size={14} /> I gave guidance</Button>}
            </div>
          </div>
          {guidance.sessions.length > 0 && (
            <ul className="space-y-1 text-xs text-slate-600">
              {guidance.sessions.slice(0, 4).map((session) => (
                <li key={session.id}><span className="font-medium text-slate-800">{session.givenBy.fullName}</span> · {day(session.givenOn)}{session.notes ? ` · ${session.notes}` : ""}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {notShared.length > 0 && (
        <Card className="overflow-hidden border-amber-200">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3">
            <UserX size={15} className="text-amber-700" />
            <p className="text-sm font-semibold text-amber-800">Shortlisted at SP but not shared with the company ({notShared.length})</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">Candidate</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Selection basis</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody>
                {notShared.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-2"><Link to={`/candidates/${row.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.candidate.fullName}</Link></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{row.product?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{row.priority ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{row.selectionBasis ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-amber-700">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ProcessStatusDialog
        open={editing}
        onOpenChange={setEditing}
        job={{ id: jobRequestId, roleTitle, companyName, phase: process.phase, roundId: process.round?.id ?? null, rounds }}
      />
      <RecordGuidanceDialog open={recording} onOpenChange={setRecording} job={{ id: jobRequestId, label: `${companyName} · ${roleTitle}` }} />
    </div>
  );
}
