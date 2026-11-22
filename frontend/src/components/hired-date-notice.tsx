import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PlacementHiredDates } from "../types/api";

/**
 * Placements count in the month the student was hired (interview done). This
 * explains where the dates came from and lists hires that still need one; they
 * sit in their job's request month until the date is added on the pipeline tab.
 */
export function HiredDateNotice({ hiredDates }: { hiredDates: PlacementHiredDates }) {
  const [open, setOpen] = useState(false);
  if (hiredDates.placements === 0) return null;
  const fallback = hiredDates.ROUND + hiredDates.JOB;
  return (
    <div className={hiredDates.missing > 0 ? "rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" : "rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"}>
      <div className="flex gap-2">
        <CalendarClock size={15} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>
            Placements count in the month the student was hired (interview done date), not the job request month.
            {" "}{hiredDates.STUDENT} of {hiredDates.placements} have the hired date entered
            {fallback > 0 && <>; {fallback} use {hiredDates.ROUND > 0 ? `the last round date (${hiredDates.ROUND})` : ""}{hiredDates.ROUND > 0 && hiredDates.JOB > 0 ? " or " : ""}{hiredDates.JOB > 0 ? `the job's process end date (${hiredDates.JOB})` : ""}</>}.
          </p>
          {hiredDates.missing > 0 && (
            <p>
              <span className="font-semibold">{hiredDates.missing} without any date</span> are counted in their job request month for now.
              {" "}Open the job's Company pipeline tab and set the student's process end date.{" "}
              <button type="button" className="font-semibold underline" onClick={() => setOpen((value) => !value)}>{open ? "Hide list" : "Show list"}</button>
            </p>
          )}
          {open && hiredDates.missing > 0 && (
            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
              {hiredDates.undated.map((row, index) => (
                <li key={row.applicationId ?? `${row.jobRequestId}-${index}`}>
                  <Link to={`/job-requests/${row.jobRequestId}?tab=pipeline`} className="hover:underline">
                    <span className="font-medium">{row.candidateName ?? "Student"}</span> · {row.companyName}{row.roleTitle ? ` · ${row.roleTitle}` : ""}{row.jobCode ? ` (${row.jobCode})` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
