import type { CompanyProcessPhase, CrmChannel, PipelineStatus, PotentialCompanyStatus } from "@placement/shared";
import type { PersonRef } from "./api";

export interface PipelineEntryHistory {
  id: string;
  fromStatus: PotentialCompanyStatus | null;
  toStatus: PotentialCompanyStatus;
  note: string | null;
  changedAt: string;
  changedBy: PersonRef;
}

export interface PipelineEntry {
  id: string;
  month: string;
  status: PotentialCompanyStatus;
  roleHint: string | null;
  expectedOpenings: number | null;
  expectedStartDate: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  jobRequest: {
    id: string; jobId: string; roleTitle: string; processPhase: CompanyProcessPhase; companyProcessStartDate: string | null;
    processRound: { name: string } | null; psmOwner: PersonRef | null;
  } | null;
  crmOwner: PersonRef | null;
  createdBy: PersonRef;
  carriedFrom: { id: string; month: string; status: PotentialCompanyStatus } | null;
  carriedTo: { id: string; month: string } | null;
  history: PipelineEntryHistory[];
  firstListedMonth: string;
}

export interface MonthlyDrive {
  jobRequestId: string;
  jobCode: string;
  roleTitle: string;
  companyId: string;
  companyName: string;
  psmName: string | null;
  status: string;
  phase: CompanyProcessPhase;
  roundName: string | null;
  requestDate: string | null;
  processStartDate: string | null;
  processEndDate: string | null;
  startsInMonth: boolean;
  endsInMonth: boolean;
  requestedInMonth: boolean;
  students: { academy: number; pool: number; shared: number; interviewed: number; selected: number };
  crmRemarkCount: number;
  lastCrmRemark: { on: string | null; remark: string } | null;
  hasRsaReview: boolean;
  onPotentialList: boolean;
}

export interface MonthlyStudentGroup {
  students: number;
  applications: number;
  finalShortlisted: number;
  shared: number;
  interviewed: number;
  selected: number;
  internalRejected: number;
  companyRejected: number;
  inProcess: number;
  stages: { label: string; reached: number; cleared: number; rejected: number; scheduled: number }[];
}

export type InternalOutcome = "SP" | "AS_REJECTED" | "SC_REJECTED" | "SC_NO_SHOW" | "RS_REJECTED" | "IN_PROGRESS";

export interface MonthlyStudent {
  applicationId: string;
  candidateId: string;
  fullName: string;
  candidateCode: string | null;
  category: string;
  academy: boolean;
  inPool: boolean;
  tier: string | null;
  jobRequestId: string;
  jobCode: string;
  roleTitle: string;
  companyId: string;
  companyName: string;
  internal: InternalOutcome;
  shared: boolean;
  interviewed: boolean;
  selected: boolean;
  pipelineStatus: PipelineStatus | null;
  lastRound: string | null;
  lastRoundOutcome: string | null;
}

export interface MonthlyPipeline {
  month: string;
  potential: {
    entries: PipelineEntry[];
    summary: {
      listed: number; active: number; starting: number; newThisMonth: number; carriedIn: number; carriedOut: number;
      droppedOrNoResponse: number; byStatus: Record<PotentialCompanyStatus, number>;
    };
  };
  drives: {
    items: MonthlyDrive[];
    summary: { live: number; companies: number; startingThisMonth: number; startingCompanies: number; endingThisMonth: number; requestedThisMonth: number };
  };
  students: { academy: MonthlyStudentGroup; pool: MonthlyStudentGroup; people: MonthlyStudent[] };
}

export interface PipelineEntryInput {
  month?: string;
  companyName?: string;
  status?: PotentialCompanyStatus;
  note?: string;
  jobRequestId?: string | null;
  roleHint?: string | null;
  expectedOpenings?: number | null;
  expectedStartDate?: string | null;
  crmOwnerId?: string | null;
  remarks?: string | null;
}

export interface CrmRemark {
  id: string;
  interactionOn: string;
  channel: CrmChannel;
  remark: string;
  nextStep: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: PersonRef;
}

export interface RsaReview {
  wentRight: string | null;
  wentWrong: string | null;
  actionItems: string | null;
  updatedAt: string;
  updatedBy: PersonRef | null;
}

export interface DriveNotes {
  crmRemarks: CrmRemark[];
  rsaReview: RsaReview | null;
  studentReports: { total: number; done: number; withSummary: number; withLink: number };
}

export interface CrmRemarkInput {
  interactionOn: string;
  channel: CrmChannel;
  remark: string;
  nextStep?: string | null;
}

export type RsaSegment = "ACADEMY_OR_POOL" | "ACADEMY" | "POOL" | "EVERYONE";
export type RsaProgress = "ALL" | "NOT_STARTED" | "IN_PROGRESS" | "DONE";

export interface RsaFilters {
  from?: string | undefined;
  to?: string | undefined;
  dateBy?: "requested" | "processEnd" | undefined;
  segment?: RsaSegment | undefined;
  progress?: RsaProgress | undefined;
  includeOngoing?: "true" | "false" | undefined;
  q?: string | undefined;
}

export interface RsaStudent {
  applicationId: string;
  candidateId: string;
  fullName: string;
  candidateCode: string | null;
  category: string;
  inPool: boolean;
  tier: string | null;
  jobRequestId: string;
  jobCode: string;
  roleTitle: string;
  companyId: string;
  companyName: string;
  phase: CompanyProcessPhase;
  month: string;
  processEndDate: string | null;
  pipelineStatus: PipelineStatus | null;
  rejectedRound: string | null;
  rejectionReason: string | null;
  rsa: {
    statusId: string;
    statusLabel: string;
    statusTone: string;
    done: boolean;
    reportSummary: string | null;
    reportUrl: string | null;
    notes: string | null;
    doneOn: string | null;
    otherContributors: string | null;
    contributors: PersonRef[];
    updatedAt: string | null;
    updatedBy: string | null;
  } | null;
}

export interface RsaWorklist {
  items: RsaStudent[];
  summary: { total: number; notStarted: number; inProgress: number; done: number; withLink: number };
}

export interface RsaReportInput {
  statusId: string;
  reportSummary?: string | null;
  reportUrl?: string | null;
  contributorIds: string[];
  otherContributors?: string | null;
  doneOn?: string | null;
}
