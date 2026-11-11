// Skipped screening, company process status and guidance: shared by the API and the UI.

export const SCREENING_SKIP_REASONS = [
  "TIME_CONSTRAINT",
  "COMPANY_REQUESTED_DIRECT",
  "REPEAT_DRIVE",
  "PRE_ASSESSED_PROFILES",
  "LOW_APPLICATIONS",
  "OTHER",
] as const;
export type ScreeningSkipReason = (typeof SCREENING_SKIP_REASONS)[number];

export const SCREENING_SKIP_REASON_LABELS: Record<ScreeningSkipReason, string> = {
  TIME_CONSTRAINT: "Time constraint",
  COMPANY_REQUESTED_DIRECT: "Company asked for profiles directly",
  REPEAT_DRIVE: "Repeat drive (screened earlier)",
  PRE_ASSESSED_PROFILES: "Profiles already assessed (pool / TR)",
  LOW_APPLICATIONS: "Too few applications",
  OTHER: "Other",
};

export const COMPANY_PROCESS_PHASES = [
  "YET_TO_SHARE_CVS",
  "CVS_SHARED",
  "HIRING_IN_PROGRESS",
  "ROUND_YET_TO_START",
  "ROUND_IN_PROGRESS",
  "ON_HOLD",
  "OFFERS_RELEASED",
  "PROCESS_DONE_HIRED",
  "PROCESS_DONE_NOT_HIRED",
] as const;
export type CompanyProcessPhase = (typeof COMPANY_PROCESS_PHASES)[number];

export const COMPANY_PROCESS_PHASE_LABELS: Record<CompanyProcessPhase, string> = {
  YET_TO_SHARE_CVS: "Yet to share CVs",
  CVS_SHARED: "CV provided",
  HIRING_IN_PROGRESS: "Hiring in progress",
  ROUND_YET_TO_START: "Yet to start",
  ROUND_IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  OFFERS_RELEASED: "Offers released",
  PROCESS_DONE_HIRED: "Process done – hired",
  PROCESS_DONE_NOT_HIRED: "Process done – not hired",
};

/** Phases after which the company's process is over for this job. */
export const PROCESS_DONE_PHASES: readonly CompanyProcessPhase[] = ["PROCESS_DONE_HIRED", "PROCESS_DONE_NOT_HIRED"];

/** Phases that name one of the job's company rounds. */
export const ROUND_PHASES: readonly CompanyProcessPhase[] = ["ROUND_YET_TO_START", "ROUND_IN_PROGRESS"];

export function isRoundPhase(phase: CompanyProcessPhase): boolean {
  return ROUND_PHASES.includes(phase);
}

/** "Yet to start TR1", "TR2 in progress", "CV provided". */
export function companyProcessLabel(phase: CompanyProcessPhase, roundName?: string | null): string {
  if (phase === "ROUND_YET_TO_START") return roundName ? `Yet to start ${roundName}` : "Next round yet to start";
  if (phase === "ROUND_IN_PROGRESS") return roundName ? `${roundName} in progress` : "Round in progress";
  return COMPANY_PROCESS_PHASE_LABELS[phase];
}

/**
 * A candidate's status with the company, derived from SP and the nomination:
 * NOT_SHARED = shortlisted at SP but not in the company sheet / not sent.
 */
export const COMPANY_SHARE_STATUSES = ["NOT_SHORTLISTED", "NOT_SHARED", "SHARED"] as const;
export type CompanyShareStatus = (typeof COMPANY_SHARE_STATUSES)[number];

// Per-student tasks: Guidance and RSA (rejection section analysis). Each has a
// status from a list the team manages, plus who contributed.

export const STUDENT_SUPPORT_KINDS = ["GUIDANCE", "RSA"] as const;
export type StudentSupportKind = (typeof STUDENT_SUPPORT_KINDS)[number];

export const STUDENT_SUPPORT_KIND_LABELS: Record<StudentSupportKind, string> = {
  GUIDANCE: "Guidance",
  RSA: "RSA",
};

export const STUDENT_SUPPORT_KIND_DESCRIPTIONS: Record<StudentSupportKind, string> = {
  GUIDANCE: "Interview guidance for this drive",
  RSA: "Rejection section analysis",
};

/** Colours a status can use. */
export const SUPPORT_TONES = ["slate", "sky", "indigo", "violet", "emerald", "amber", "orange", "rose"] as const;
export type SupportTone = (typeof SUPPORT_TONES)[number];
