import type { CompanyProcessPhase, InterviewOutcome, PipelineStatus } from "@placement/shared";
import type { InsightDateBasis } from "./tracking";

export type AcademyCategory = "ACADEMY" | "ACADEMY_INTENSIVE" | "ALL_ACADEMY";
export type AcademySegment = "ALL" | "ASSESSED_POOL" | "NOT_IN_POOL" | "BUCKET_A" | "BUCKET_B" | "BUCKET_C";
export type AcademyComparison = "OVERALL" | "ACADEMY" | "ASSESSED_POOL" | "NOT_IN_POOL" | "BUCKET_A" | "BUCKET_B" | "BUCKET_C";
export type AcademyCandidateView = "ALL" | "APPLIED" | "POOL" | "POOL_APPLIED" | "POOL_ZERO_APPLICATIONS" | "POOL_ZERO_OPPORTUNITY" | "ZERO_APPLICATIONS";

export interface AcademyFilters {
  from?: string | undefined;
  to?: string | undefined;
  dateBy?: InsightDateBasis | undefined;
  academyCategory?: AcademyCategory | undefined;
  segment?: AcademySegment | undefined;
}

export interface AcademyMetrics {
  applications: number;
  students: number;
  resumeShortlisted: number;
  screeningCleared: number;
  assignmentCleared: number;
  finalShortlisted: number;
  internalRejected: number;
  rejectedAt: { RS: number; SC: number; AS: number };
  screeningNoShow: number;
  shared: number;
  interviewed: number;
  interviews: number;
  studentsInterviewed: number;
  selected: number;
  studentsSelected: number;
  offered: number;
  joined: number;
}

export interface AcademyRound {
  label: string;
  appeared: number;
  cleared: number;
  rejected: number;
  noShow: number;
  scheduled: number;
}

export interface AcademyPoolTier {
  tier: string | null;
  total: number;
  matched: number;
  applied: number;
  zeroApplications: number;
  zeroOpportunity: number;
  withOpportunity: number;
  interviewed: number;
  selected: number;
  applications: number;
}

export interface AcademyConcludedJob {
  jobRequestId: string;
  roleTitle: string;
  companyId: string;
  companyName: string;
  phase: CompanyProcessPhase;
  processEndDate: string | null;
  month: string;
  shared: number;
  selected: number;
  notSelected: number;
  rsaDone: number;
  rsaOpen: number;
  rsaNotStarted: number;
  rsaStatuses: { label: string; count: number }[];
}

export interface AcademyInsights {
  segments: ({ segment: AcademyComparison } & AcademyMetrics)[];
  companyRounds: { label: string; bySegment: Record<AcademyComparison, AcademyRound> }[];
  rejectionBuckets: { bucket: string; total: number; byStage: { RS: number; SC: number; AS: number }; topReasons: { reason: string; count: number }[] }[];
  rejectionsWithoutReason: number;
  byTechStack: ({ skill: string; jobs: number; companies: number } & AcademyMetrics)[];
  byCtcBand: ({ band: string; jobs: number } & AcademyMetrics)[];
  byJob: ({ jobRequestId: string; roleTitle: string; companyId: string; companyName: string; month: string; ctcLpa: number | null; phase: CompanyProcessPhase; skills: string | null; rounds: AcademyRound[] } & AcademyMetrics)[];
  applicationsPerCandidate: { band: string; academy: number; pool: number }[];
  pool: { totals: AcademyPoolTier | null; byTier: AcademyPoolTier[] };
  concluded: {
    companies: number;
    jobCount: number;
    rsaComplete: number;
    rsaPartial: number;
    rsaNotDone: number;
    nothingToReview: number;
    studentsToReview: number;
    studentsReviewed: number;
    jobs: AcademyConcludedJob[];
  };
}

export interface AcademyCandidate {
  candidateId: string | null;
  fullName: string;
  candidateCode: string | null;
  mobile: string | null;
  category: string;
  inPool: boolean;
  /** Which assessed-pool tab they came from. */
  poolSource: "OFFLINE" | "COMPETENCY" | "BOTH" | null;
  /** Product names, comma separated; null when none is on record. */
  product: string | null;
  tier: string | null;
  tr1Status: string | null;
  tr2Status: string | null;
  applications: number;
  /** Distinct companies applied to in the period. */
  companies: number;
  internalRejected: number;
  finalShortlisted: number;
  shared: number;
  interviewed: number;
  interviews: number;
  selected: number;
  lastMonth: string | null;
  /** Applications passing / rejected at each internal stage (a later pass counts as passing earlier stages). */
  internalStages: {
    RS: { selected: number; rejected: number };
    SC: { selected: number; rejected: number; noShow: number };
    AS: { selected: number; rejected: number };
  };
  /** Company rounds cleared / rejected; only rounds the candidate sat appear. */
  companyStages: Partial<Record<AcademyCompanyStage, { cleared: number; rejected: number }>>;
  /** Company-round rejections in the period and the reasons they were tagged with. */
  companyRejected: number;
  rejectionReasons: string[];
}

export type AcademyStageFilter =
  | "RESUME_REJECTED" | "SCREENING_REJECTED" | "SCREENING_NO_SHOW" | "ASSIGNMENT_REJECTED" | "INTERNAL_REJECTED"
  | "FINAL_SHORTLISTED" | "SHARED" | "NOT_SHARED" | "INTERVIEWED" | "COMPANY_REJECTED" | "SELECTED";
export type AcademyPoolFilter = "ANY" | "NONE" | "OFFLINE" | "COMPETENCY" | "BOTH";

export interface AcademyCandidateFilters {
  view: AcademyCandidateView;
  q?: string | undefined;
  poolSource?: AcademyPoolFilter | undefined;
  product?: string | undefined;
  stage?: AcademyStageFilter | undefined;
  reasonTagId?: string | undefined;
}

/** Company-round rejections grouped by reason tag. */
export interface CompanyReasons {
  totals: { rejections: number; tagged: number; untagged: number };
  byTag: { tagId: string | null; label: string; removed: boolean; rejections: number; students: number; academy: number; pool: number; withNote: number; withDoc: number }[];
  byRound: { round: string; sort: number; tagId: string | null; label: string; count: number }[];
  byCompany: { jobRequestId: string; companyName: string; roleTitle: string; tagId: string | null; label: string; count: number }[];
  students: {
    applicationId: string; candidateId: string; fullName: string; candidateCode: string; product: string | null; inPool: boolean;
    companyName: string; roleTitle: string; jobCode: string | null; roundName: string; reason: string; note: string | null; docUrl: string | null;
  }[];
}

export type AcademyCompanyStage = "CV" | "ASSESSMENT" | "TR1" | "TR2" | "TR3" | "MR" | "CLIENT" | "HR" | "OTHER";

export type StageResult = "SELECTED" | "REJECTED" | "NO_SHOW" | null;

/** One application of a student, for the expandable row in the candidate list. */
export interface AcademyStudentApplication {
  applicationId: string;
  jobRequestId: string;
  jobCode: string | null;
  roleTitle: string;
  companyId: string;
  companyName: string;
  month: string;
  /** null = never reached (or the stage was not run and they went no further). */
  internal: { RS: StageResult; SC: StageResult; AS: StageResult; SP: "SELECTED" | null };
  rejectedStage: string | null;
  rejectionReason: string | null;
  shared: boolean;
  pipelineStatus: PipelineStatus | null;
  selected: boolean;
  rounds: { label: string; outcome: InterviewOutcome; reason: string | null; tag?: string | null; docUrl?: string | null }[];
}
