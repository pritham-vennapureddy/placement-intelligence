// Internal screening (TA → RS → SC → AS → SP) and the company pipeline.

export const INTERNAL_STAGES = [
  "TOTAL_APPLICATIONS",
  "RESUME_SHORTLIST",
  "SCREENING_SHORTLIST",
  "ASSIGNMENT_SHORTLIST",
  "FINAL_SHORTLIST",
] as const;
export type InternalStage = (typeof INTERNAL_STAGES)[number];

/** Stages that hold candidate decisions; TA is the set of applications itself. */
export const DECISION_STAGES = INTERNAL_STAGES.filter((stage) => stage !== "TOTAL_APPLICATIONS") as Exclude<InternalStage, "TOTAL_APPLICATIONS">[];
export type DecisionStage = (typeof DECISION_STAGES)[number];

export const STAGE_LABELS: Record<InternalStage, { code: string; label: string }> = {
  TOTAL_APPLICATIONS: { code: "TA", label: "Total applications" },
  RESUME_SHORTLIST: { code: "RS", label: "Resume shortlist" },
  SCREENING_SHORTLIST: { code: "SC", label: "Screening shortlist" },
  ASSIGNMENT_SHORTLIST: { code: "AS", label: "Assignment shortlist" },
  FINAL_SHORTLIST: { code: "SP", label: "Final shortlist" },
};

export const STAGE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "PARTIALLY_COMPLETED", "NOT_CONDUCTED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partially completed",
  NOT_CONDUCTED: "Not conducted",
};

export const STAGE_OUTCOMES = ["PENDING", "SELECTED", "REJECTED", "ON_HOLD", "NO_SHOW", "WITHDRAWN"] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];
export const STAGE_OUTCOME_LABELS: Record<StageOutcome, string> = {
  PENDING: "Pending",
  SELECTED: "Selected",
  REJECTED: "Rejected",
  ON_HOLD: "On hold",
  NO_SHOW: "No show",
  WITHDRAWN: "Withdrawn",
};

export const PRIORITIES = ["P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

// ── Company pipeline ──

export const PIPELINE_STATUSES = [
  "NOT_SUBMITTED",
  "IN_PROCESS",
  "ON_HOLD",
  "REJECTED",
  "SELECTED",
  "OFFER_RELEASED",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "JOINED",
  "DROPPED",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  NOT_SUBMITTED: "Not shared with company",
  IN_PROCESS: "In company process",
  ON_HOLD: "On hold",
  REJECTED: "Rejected by company",
  SELECTED: "Selected",
  OFFER_RELEASED: "Offer released",
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  JOINED: "Joined",
  DROPPED: "Dropped",
};

/** Allowed manual moves. Assumed rules, to confirm with the PSM team. */
export const PIPELINE_TRANSITIONS: Record<PipelineStatus, readonly PipelineStatus[]> = {
  NOT_SUBMITTED: ["IN_PROCESS"],
  IN_PROCESS: ["ON_HOLD", "REJECTED", "SELECTED", "DROPPED"],
  ON_HOLD: ["IN_PROCESS", "REJECTED", "SELECTED", "DROPPED"],
  REJECTED: [],
  SELECTED: ["OFFER_RELEASED", "DROPPED"],
  OFFER_RELEASED: ["OFFER_ACCEPTED", "OFFER_DECLINED"],
  OFFER_ACCEPTED: ["JOINED", "DROPPED"],
  OFFER_DECLINED: [],
  JOINED: [],
  DROPPED: [],
};

export function canMovePipeline(from: PipelineStatus, to: PipelineStatus): boolean {
  return PIPELINE_TRANSITIONS[from].includes(to);
}

/** Statuses reached only by a PSM recording offers and joining; imports never overwrite them. */
export const POST_SELECTION_STATUSES: readonly PipelineStatus[] = ["OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED", "DROPPED"];

export const ROUND_TYPES = ["RESUME_SCREENING", "ASSIGNMENT", "TECHNICAL", "MANAGERIAL", "HR", "CLIENT", "OTHER"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];
export const ROUND_TYPE_LABELS: Record<RoundType, string> = {
  RESUME_SCREENING: "Resume screening",
  ASSIGNMENT: "Assignment",
  TECHNICAL: "Technical",
  MANAGERIAL: "Managerial",
  HR: "HR",
  CLIENT: "Client",
  OTHER: "Other",
};

export const INTERVIEW_OUTCOMES = ["SCHEDULED", "CLEARED", "REJECTED", "ON_HOLD", "NO_SHOW", "CANCELLED"] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];
export const INTERVIEW_OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  SCHEDULED: "Scheduled / in progress",
  CLEARED: "Cleared",
  REJECTED: "Rejected",
  ON_HOLD: "On hold",
  NO_SHOW: "No show",
  CANCELLED: "Cancelled",
};

// ── Suggested meanings for values found in sheets (the PSM confirms them) ──

/** Key used to match sheet values to their meaning, ignoring case and punctuation. */
export function normalizeValueKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
const norm = normalizeValueKey;

export function suggestStageOutcome(value: string): StageOutcome | null {
  const v = norm(value);
  if (!v) return null;
  if (/^(c|consider|considered|selected|select|shortlisted|shortlist|yes|y|cleared|pass|passed|go)$/.test(v)) return "SELECTED";
  if (/^(r|reject|rejected|not selected|no|n|fail|failed|not shortlisted|drop|dropped)$/.test(v)) return "REJECTED";
  if (/^(h|hold|on hold|maybe|waitlist|waitlisted)$/.test(v)) return "ON_HOLD";
  if (/^(no show|noshow|absent|ns|na|n a|not available|not attended|did not attend|not joined|didn t join)$/.test(v)) return "NO_SHOW";
  if (/^(withdrawn|withdraw|not interested)$/.test(v)) return "WITHDRAWN";
  if (/^(pending|in progress|scheduled|tbd)$/.test(v)) return "PENDING";
  return null;
}

export function suggestInterviewOutcome(value: string): InterviewOutcome | null {
  const v = norm(value);
  if (!v) return null;
  if (/^(cleared|clear|selected|select|pass|passed|yes|y|qualified|shortlisted|completed)$/.test(v)) return "CLEARED";
  if (/^(rejected|reject|not selected|no|n|fail|failed|not qualified)$/.test(v)) return "REJECTED";
  if (/^(hold|on hold)$/.test(v)) return "ON_HOLD";
  if (/^(no show|absent|not attended|did not attend)$/.test(v)) return "NO_SHOW";
  if (/^(cancelled|canceled)$/.test(v)) return "CANCELLED";
  if (/^(scheduled|pending|in progress|ongoing|tbd)$/.test(v)) return "SCHEDULED";
  return null;
}

export function suggestPipelineStatus(value: string): PipelineStatus | null {
  const v = norm(value);
  if (!v) return null;
  if (/^(selected|select|offer pending|final select|cleared|hired)$/.test(v)) return "SELECTED";
  if (/^(rejected|reject|not selected|no|fail|failed)$/.test(v)) return "REJECTED";
  if (/^(hold|on hold)$/.test(v)) return "ON_HOLD";
  if (/^(offer released|offered|offer sent|offer)$/.test(v)) return "OFFER_RELEASED";
  if (/^(offer accepted|accepted)$/.test(v)) return "OFFER_ACCEPTED";
  if (/^(offer declined|declined)$/.test(v)) return "OFFER_DECLINED";
  if (/^(joined|onboarded)$/.test(v)) return "JOINED";
  if (/^(dropped|dropout|drop out|withdrawn|backed out)$/.test(v)) return "DROPPED";
  if (/^(in process|in progress|pending|scheduled|ongoing)$/.test(v)) return "IN_PROCESS";
  return null;
}

/** Spreadsheet column letter for a 0-based index (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
