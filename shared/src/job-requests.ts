// Job request lifecycle, shared so the API enforces and the UI offers the same moves.

export const JOB_REQUEST_STATUSES = ["DRAFT", "OPEN", "ON_HOLD", "FILLED", "CANCELLED", "CLOSED"] as const;
export type JobRequestStatus = (typeof JOB_REQUEST_STATUSES)[number];

/**
 * Allowed status changes. Assumed rules, to confirm with the PSM team:
 * filled or closed jobs can be reopened; cancelled is final.
 */
export const JOB_STATUS_TRANSITIONS: Record<JobRequestStatus, readonly JobRequestStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["ON_HOLD", "FILLED", "CLOSED", "CANCELLED"],
  ON_HOLD: ["OPEN", "CLOSED", "CANCELLED"],
  FILLED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
  CANCELLED: [],
};

export function canTransitionJob(from: JobRequestStatus, to: JobRequestStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

/** Putting a job on hold, cancelling it or reopening it needs a written reason. */
export function jobTransitionNeedsReason(from: JobRequestStatus, to: JobRequestStatus): boolean {
  return to === "ON_HOLD" || to === "CANCELLED" || (to === "OPEN" && (from === "FILLED" || from === "CLOSED"));
}

export const JOB_STATUS_LABELS: Record<JobRequestStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ON_HOLD: "On hold",
  FILLED: "Filled",
  CANCELLED: "Cancelled",
  CLOSED: "Closed",
};
