import type {
  DecisionStage,
  InternalStage,
  InterviewOutcome,
  PaginationMeta,
  PipelineStatus,
  Priority,
  RoundType,
  StageOutcome,
  StageStatus,
} from "@placement/shared";
import type { PersonRef } from "./api";

export interface CandidateSummary {
  id: string;
  candidateCode: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  college: string | null;
  graduationYear: number | null;
  resumeUrl: string | null;
  category: "ACADEMY" | "ACADEMY_INTENSIVE" | "EXTERNAL" | null;
  assessedPool: "YES" | "NO" | "UNKNOWN";
}

export interface StageView {
  id: string;
  stage: InternalStage;
  status: StageStatus;
  completedAt: string | null;
  nextPlannedDate: string | null;
  remarks: string | null;
  owner: PersonRef | null;
  counts: Partial<Record<StageOutcome, number>>;
  completionLog: { fromStatus: StageStatus; toStatus: StageStatus; remarks: string | null; recordedAt: string; recordedBy: { fullName: string } | null }[];
}

export interface ScreeningProcess {
  id: string;
  shortlistingNotes: string | null;
  totalApplications: number;
  canEdit: boolean;
  stages: StageView[];
}

export interface StageCandidateRow {
  id?: string;
  outcome?: StageOutcome;
  priority?: Priority | null;
  techScore?: number | null;
  commScore?: number | null;
  rejectionReason?: string | null;
  remarks?: string | null;
  source?: string;
  decidedAt?: string | null;
  decidedBy?: { fullName: string } | null;
  application: {
    id: string;
    product: { code: string; name: string } | null;
    appliedAt?: string;
    source?: string;
    candidate: CandidateSummary;
  };
}

export interface Paged<T> {
  items: T[];
  meta: PaginationMeta;
}

// ── Imports ──

export type ImportTarget = "INTERNAL_SCREENING" | "COMPANY_PIPELINE";

export interface ImportIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
}

export interface InternalSummary {
  applications: { total: number; newCandidates: number; newApplications: number; updated: number; unchanged: number; errors: number };
  stages: Partial<Record<DecisionStage, { mode: string; rows: number; selected: number; rejected: number; onHold: number; pending: number; other: number; errors: number; conflicts: number }>>;
  otherJobIds: { jobId: string; label: string | null; rows: number }[];
  missingFromSource: number;
  issues: Record<"ERROR" | "WARNING" | "INFO", number>;
}

export interface CompanySummary {
  rows: number;
  matched: number;
  unmatched: number;
  newNominations: number;
  statusChanges: number;
  rounds: { name: string; roundType: RoundType; exists: boolean }[];
  byStatus: Partial<Record<PipelineStatus, number>>;
  issues: Record<"ERROR" | "WARNING" | "INFO", number>;
}

export interface ImportBatch {
  id: string;
  batchCode: string;
  target: ImportTarget;
  sourceType: string;
  status: "UPLOADED" | "VALIDATED" | "COMMITTED" | "CANCELLED";
  jobRequestId: string;
  sourceFileName: string;
  fileSize: number;
  sheets: { name: string; rowCount: number; columnCount: number }[];
  mapping: Record<string, unknown> | null;
  summary: InternalSummary | CompanySummary | null;
  createdAt: string;
  committedAt: string | null;
  importedBy: PersonRef;
  jobRequest: { id: string; jobId: string; roleTitle: string; company: { id: string; name: string } };
  batchIssues?: ImportIssue[];
}

export interface ImportRow {
  id: string;
  sourceRowNumber: number;
  sourceRowRef: string | null;
  rawData: Record<string, string>;
  normalizedData: Record<string, unknown>;
  validationStatus: "VALID" | "WARNING" | "INVALID";
  approvalStatus: "INCLUDED" | "EXCLUDED";
  action: "CREATE" | "UPDATE" | "NO_CHANGE" | "CONFLICT" | "SKIP";
  committedAt: string | null;
  sheetMapping: { role: string; worksheetName: string };
  issues: ImportIssue[];
}

export interface ValueSuggestion {
  key: string;
  value: string;
  count: number;
  suggested: { stage: StageOutcome | null; interview: InterviewOutcome | null; pipeline: PipelineStatus | null };
}

// ── Pipeline ──

export interface Round {
  id: string;
  name: string;
  roundType: RoundType;
  sequence: number;
  interviews: number;
}

export interface Nomination {
  id: string;
  status: "NOMINATED" | "WITHDRAWN";
  pipelineStatus: PipelineStatus;
  source: string;
  submittedAt: string | null;
  offerReleasedAt: string | null;
  offerAcceptedAt: string | null;
  joinedAt: string | null;
  remarks: string | null;
  createdAt: string;
  nominatedBy: { fullName: string };
  application: {
    id: string;
    product: { code: string; name: string } | null;
    candidate: CandidateSummary;
    stageOutcomes: { outcome: StageOutcome; priority: Priority | null }[];
  };
  interviews: { roundId: string; outcome: InterviewOutcome; scheduledAt: string | null; interviewerName: string | null; feedback: string | null; rejectionReason: string | null }[];
  stageHistory: { fromStatus: PipelineStatus | null; toStatus: PipelineStatus; notes: string | null; source: string; changedAt: string; changedBy: { fullName: string } | null }[];
}

export interface PipelineView {
  canEdit: boolean;
  rounds: Round[];
  nominations: Nomination[];
  eligibleToNominate: number;
}

export interface EligibleApplication {
  id: string;
  product: { code: string; name: string } | null;
  candidate: CandidateSummary;
  outcomes: Partial<Record<InternalStage, StageOutcome>>;
  finalPriority: Priority | null;
}

// ── Candidates ──

export interface CandidateListItem extends Pick<CandidateSummary, "id" | "candidateCode" | "fullName" | "email" | "mobile" | "college" | "graduationYear" | "category" | "assessedPool"> {
  updatedAt: string;
  products: { code: string; name: string }[];
  applications: number;
}

export interface CandidateDetail extends CandidateSummary {
  gender: string | null;
  currentCity: string | null;
  state: string | null;
  degree: string | null;
  department: string | null;
  academicScore: number | null;
  createdAt: string;
  products: { firstSeenAt: string; product: { code: string; name: string; category: string } }[];
  skills: string[];
  applications: {
    id: string;
    appliedAt: string;
    source: string;
    status: string;
    product: { code: string; name: string } | null;
    sourceApplication: { jobRequest: { id: string; roleTitle: string; company: { name: string } } } | null;
    jobRequest: { id: string; jobId: string; roleTitle: string; status: string; company: { id: string; name: string } };
    stageOutcomes: { outcome: StageOutcome; priority: Priority | null; rejectionReason: string | null; remarks: string | null; source: string; decidedAt: string | null; stage: { stage: InternalStage } }[];
    nomination: {
      pipelineStatus: PipelineStatus;
      status: string;
      submittedAt: string | null;
      offerReleasedAt: string | null;
      offerAcceptedAt: string | null;
      joinedAt: string | null;
      interviews: { outcome: InterviewOutcome; round: { name: string; sequence: number } }[];
      stageHistory: { fromStatus: PipelineStatus | null; toStatus: PipelineStatus; changedAt: string; notes: string | null }[];
    } | null;
  }[];
  history: import("./api").AuditEntry[];
}

export interface CarryOverSource {
  id: string;
  jobId: string;
  roleTitle: string;
  requestDate: string;
  status: string;
  company: { id: string; name: string };
  applications: number;
  sameCompany: boolean;
}

export interface CarryOverCandidate {
  id: string;
  candidate: CandidateSummary;
  outcomes: Partial<Record<DecisionStage, StageOutcome>>;
  nomination: { pipelineStatus: PipelineStatus } | null;
  alreadyOnThisJob: boolean;
}

export interface JobProgress {
  id: string;
  jobId: string;
  roleTitle: string;
  status: string;
  deadline: string | null;
  company: { id: string; name: string };
  psmOwner: PersonRef | null;
  applications: number;
  stages: Partial<Record<InternalStage, StageStatus>>;
  selected: Partial<Record<InternalStage, number>>;
  pipeline: Partial<Record<PipelineStatus, number>>;
}

export interface Funnel {
  candidates: number;
  applications: number;
  resumeShortlisted: number;
  screeningShortlisted: number;
  assignmentShortlisted: number;
  finalShortlisted: number;
  nominated: number;
  inCompanyProcess: number;
  selected: number;
  offersReleased: number;
  offersAccepted: number;
  joined: number;
}
