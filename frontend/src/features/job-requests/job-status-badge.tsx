import { JOB_STATUS_LABELS, type JobRequestStatus } from "@placement/shared";
import { Badge } from "../../components/ui/badge";

const styles: Record<JobRequestStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-50 text-slate-600",
  OPEN: "border-sky-200 bg-sky-50 text-sky-700",
  ON_HOLD: "border-amber-200 bg-amber-50 text-amber-700",
  FILLED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-rose-200 bg-rose-50 text-rose-700",
  CLOSED: "border-slate-200 bg-slate-100 text-slate-600",
};

export function JobStatusBadge({ status }: { status: JobRequestStatus }) {
  return <Badge variant="outline" className={styles[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
