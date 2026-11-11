import type { CompanyProcessPhase, CompanyShareStatus, JobRequestStatus, PaginationMeta, PipelineStatus, ScreeningSkipReason, StudentSupportKind, SupportTone } from "@placement/shared";

export interface PersonOption { id: string; fullName: string }

/** One entry in the team-managed Guidance or RSA status list. */
export interface SupportStatusOption {
  id: string;
  kind: StudentSupportKind;
  label: string;
  tone: SupportTone;
  countsAsDone: boolean;
  needsContributor: boolean;
  needsNote: boolean;
  sortOrder: number;
  /** Set when deleted while students still had it. */
  archivedAt: string | null;
  /** How many students have it (only from the status-list endpoint). */
  inUse?: number;
}

/** One Guidance or RSA record for a student. */
export interface StudentSupport {
  status: { id: string; label: string; tone: SupportTone; archivedAt: string | null };
  doneOn: string | null;
  otherContributors: string | null;
  notes: string | null;
  updatedAt: string;
  updatedBy: PersonOption | null;
  contributors: PersonOption[];
}

export interface StudentSupportInput {
  statusId: string;
  contributorIds: string[];
  otherContributors?: string | null;
  doneOn?: string | null;
  notes?: string | null;
}

export interface JobTracking {
  canEdit: boolean;
  process: {
    phase: CompanyProcessPhase;
    round: { id: string; name: string } | null;
    label: string;
    updatedAt: string | null;
    history: { id: string; fromPhase: CompanyProcessPhase | null; toPhase: CompanyProcessPhase; roundName: string | null; label: string; notes: string | null; changedAt: string; changedBy: { fullName: string } | null }[];
  };
  guidance: {
    sessions: { id: string; givenOn: string; notes: string | null; givenBy: { id: string; fullName: string } }[];
    studentsGuided: number;
  };
  notShared: {
    id: string;
    product: { name: string } | null;
    candidate: { id: string; fullName: string; candidateCode: string };
    reason: string;
    priority: string | null;
    selectionBasis: string | null;
  }[];
}

export interface GuidanceJobOption {
  id: string;
  jobId: string;
  roleTitle: string;
  status: JobRequestStatus;
  company: { name: string };
  psmOwner: { id: string; fullName: string } | null;
}

export interface GuidanceView {
  job: {
    id: string;
    jobId: string;
    roleTitle: string;
    status: JobRequestStatus;
    processLabel: string;
    company: { id: string; name: string };
    psmOwner: { id: string; fullName: string } | null;
  };
  sessions: { id: string; givenOn: string; notes: string | null; givenBy: { id: string; fullName: string }; recordedBy: { id: string; fullName: string }; canDelete: boolean }[];
  students: {
    id: string;
    product: { name: string } | null;
    candidate: { id: string; fullName: string; candidateCode: string };
    shareStatus: CompanyShareStatus;
    pipelineStatus: PipelineStatus | null;
    guidance: StudentSupport | null;
    rsa: StudentSupport | null;
  }[];
  people: PersonOption[];
  statusOptions: SupportStatusOption[];
  canEdit: boolean;
}

export interface JobCounts {
  applications: number;
  internalRejected: number;
  finalShortlisted: number;
  shared: number;
  notShared: number;
  inProcess: number;
  rejectedByCompany: number;
  selected: number;
  offers: number;
  joined: number;
  studentsGuided: number;
  studentsRsaDone: number;
}

export interface MyWorkJob {
  id: string;
  jobId: string;
  roleTitle: string;
  status: JobRequestStatus;
  openings: number;
  requestDate: string;
  deadline: string | null;
  processPhase: CompanyProcessPhase;
  processPhaseAt: string | null;
  processRound: { id: string; name: string } | null;
  processLabel: string;
  company: { id: string; name: string };
  rounds: { id: string; name: string }[];
  counts: JobCounts;
  screeningSkipped: { reason: ScreeningSkipReason | null; note: string | null } | null;
  guidance: { sessions: number; last: { givenOn: string; givenBy: { id: string; fullName: string } } | null; givers: string[] };
}

export interface MyWork {
  owner: { id: string; fullName: string };
  canEdit: boolean;
  owners: { id: string; fullName: string }[];
  totals: JobCounts & { jobs: number; activeJobs: number; guidancePending: number };
  jobs: MyWorkJob[];
  guidanceGivenElsewhere: { id: string; givenOn: string; notes: string | null; jobRequest: { id: string; roleTitle: string; company: { name: string }; psmOwner: { fullName: string } | null } }[];
}

export interface InsightMetrics {
  applications: number;
  students: number;
  academyApplications: number;
  internalRejected: number;
  academyInternalRejected: number;
  rejectedAt: { RS: number; SC: number; AS: number };
  screeningNoShow: number;
  finalShortlisted: number;
  shared: number;
  notShared: number;
  inProcess: number;
  companyRejected: number;
  selected: number;
  offers: number;
  joined: number;
}

export type InsightCategory = "ACADEMY" | "ACADEMY_INTENSIVE" | "EXTERNAL";

export interface InsightFilters {
  from?: string | undefined;
  to?: string | undefined;
  category?: InsightCategory | undefined;
  companyId?: string | undefined;
}

export interface Insights {
  totals: InsightMetrics;
  byCategory: (InsightMetrics & { category: string })[];
  byCompany: (InsightMetrics & { companyId: string; companyName: string; jobs: number })[];
  byMonth: (InsightMetrics & { month: string; jobs: number; companies: number })[];
  screeningSkipped: {
    total: number;
    byReason: { reason: ScreeningSkipReason | "UNSPECIFIED"; count: number }[];
    jobs: { jobRequestId: string; roleTitle: string; companyId: string; companyName: string; ownerName: string | null; month: string; reason: ScreeningSkipReason | null; note: string | null; finalShortlisted: number }[];
  };
  rejectionReasons: { stage: string; reason: string; count: number }[];
  activeJobsByPhase: { phase: CompanyProcessPhase; count: number }[];
}

export type StudentStatusFilter = "INTERNAL_REJECTED" | "FINAL_SHORTLIST" | "NOT_SHARED" | "SHARED" | "IN_PROCESS" | "COMPANY_REJECTED" | "SELECTED" | "JOINED";

export interface StudentInsight {
  applicationId: string;
  candidateId: string;
  fullName: string;
  candidateCode: string;
  mobile: string | null;
  category: string;
  productName: string | null;
  jobRequestId: string;
  roleTitle: string;
  companyId: string;
  companyName: string;
  month: string;
  rejectedAt: "RS" | "SC" | "AS" | null;
  screeningNoShow: boolean;
  finalShortlisted: boolean;
  shareStatus: CompanyShareStatus;
  pipelineStatus: PipelineStatus | null;
  rejectionReason: string | null;
  guidance: string | null;
  rsa: string | null;
}

export interface StudentInsightsPage {
  items: StudentInsight[];
  meta: PaginationMeta;
}
