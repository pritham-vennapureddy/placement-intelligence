import { JOB_STATUS_LABELS, type JobRequestStatus } from "@placement/shared";
import { format } from "date-fns";
import { History } from "lucide-react";
import type { AuditEntry } from "../types/api";
import { EmptyState } from "./states";

const ACTION_LABELS: Record<string, string> = {
  COMPANY_CREATED: "Company added",
  COMPANY_UPDATED: "Company details changed",
  JOB_REQUEST_ADDED: "Job request added",
  JOB_REQUEST_CREATED: "Job request created",
  JOB_REQUEST_UPDATED: "Job request edited",
  JOB_REQUEST_STATUS_CHANGED: "Status changed",
  JOB_REQUEST_REASSIGNED: "Owner changed",
};

const FIELD_LABELS: Record<string, string> = {
  hubspotCompanyId: "HubSpot company",
  hubspotDealId: "HubSpot deal",
  jobId: "Job ID",
  roleTitle: "Role",
  requiredCandidateCount: "Profiles required",
  requestDate: "Request date",
  shortlistingMechanism: "Shortlisting mechanism",
  companyRemarks: "Company remarks",
  companySheetUrl: "Company sheet",
  internalSheetUrl: "Internal sheet",
  techStack: "Tech stack",
  eligibleProductIds: "Eligible products",
};

const label = (key: string) => FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return format(new Date(value), "d MMM yyyy");
  return String(value);
}

function describe(entry: AuditEntry): string[] {
  const meta = entry.metadata ?? {};
  if (entry.action === "JOB_REQUEST_STATUS_CHANGED") {
    const status = (value: unknown) => JOB_STATUS_LABELS[value as JobRequestStatus] ?? show(value);
    return [`${status(meta.from)} → ${status(meta.to)}${meta.reason ? ` · “${show(meta.reason)}”` : ""}`];
  }
  if (entry.action === "JOB_REQUEST_ADDED") {
    return [`${show(meta.roleTitle)}`];
  }
  if (entry.action === "JOB_REQUEST_REASSIGNED" && meta.notes) {
    return [`“${show(meta.notes)}”`];
  }
  const changes = meta.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (changes) {
    // Product changes are stored as IDs; show only that they changed.
    return Object.entries(changes).map(([key, change]) =>
      key === "eligibleProductIds" ? "Eligible products updated" : `${label(key)}: ${show(change.from)} → ${show(change.to)}`);
  }
  return [];
}

export function HistoryList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState icon={History} title="No history yet" />;
  }
  return (
    <ol className="divide-y divide-slate-100">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 px-5 py-3.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-800">{ACTION_LABELS[entry.action] ?? entry.action}</p>
            {describe(entry).map((line) => (
              <p key={line} className="mt-0.5 break-words text-xs text-slate-500">{line}</p>
            ))}
          </div>
          <div className="shrink-0 text-right text-xs text-slate-400">
            <p>{format(new Date(entry.createdAt), "d MMM yyyy, HH:mm")}</p>
            <p>{entry.actor?.fullName ?? "System"}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
