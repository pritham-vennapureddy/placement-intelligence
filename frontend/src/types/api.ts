import type { CompanyProcessPhase, JobRequestStatus } from "@placement/shared";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

export interface DashboardSummary {
  totalCompanies: number;
  activeJobRequests: number;
  openPositions: number;
  employeeCount: number;
  scope: "organization" | "team" | "individual";
  teamName: string | null;
  funnel?: import("./workflow").Funnel;
  companies: {
    id: string;
    name: string;
    jobRequests: {
      id: string;
      jobId: string;
      roleTitle: string;
      openings: number;
      status: string;
      processPhase: CompanyProcessPhase;
      processPhaseAt: string | null;
      processLabel: string;
      processRoundId: string | null;
      rounds: { id: string; name: string }[];
      psmOwner: PersonRef | null;
      applications: number;
    }[];
  }[];
}

export type PlacementSegmentKey = "TEAM_BELOW_8" | "ACADEMY_BELOW_8" | "INTENSIVE_BELOW_8" | "EXTERNAL_BELOW_8" | "ACADEMY_ALL";

export interface PlacementKpiValues {
  placements: number;
  positions: number;
  positionsClosed: number;
  positionsClosedPct: number | null;
  companies: number;
  companiesHired: number;
  hiredConversionPct: number | null;
  profilesConsidered: number;
  profileToHirePct: number | null;
}

export type PlacementKpiSet = Record<PlacementSegmentKey, PlacementKpiValues>;

export interface PlacementKpis {
  from: string | null;
  to: string | null;
  ctcThresholdLpa: number;
  segments: { key: PlacementSegmentKey; label: string; detail: string }[];
  totals: PlacementKpiSet;
  monthly: { month: string; kpis: PlacementKpiSet }[];
  companies: { id: string; name: string; kpis: PlacementKpiSet }[];
  coverage: { jobs: number; jobsWithoutCtc: number; jobsAtOrAboveThreshold: number };
}

export interface CompanyAnalytics {
  company: { id: string; name: string };
  totals: {
    applications: number;
    resumeShortlisted: number;
    screeningShortlisted: number;
    assignmentShortlisted: number;
    finalShortlisted: number;
    inAssessedPool: number;
    screeningNoShow: number;
  };
  products: {
    id: string;
    name: string;
    category: string;
    applicants: number;
    resumeShortlisted: number;
    screeningShortlisted: number;
    assignmentShortlisted: number;
    finalShortlisted: number;
    inPool: number;
    poolFinalShortlisted: number;
  }[];
  jobs: {
    id: string;
    jobId: string;
    roleTitle: string;
    openings: number;
    status: JobRequestStatus;
    applications: number;
    breakdown: {
      applications: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
      shortlisted: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
      resumeShortlisted: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
      screeningShortlisted: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
      assignmentShortlisted: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
      finalShortlisted: { total: number; intensive: number; academy: number; external: number; inPool: number; competencyPool: number; trCleared: number; buckets: Record<"A" | "B" | "C" | "D", number>; competencyLevels: Record<string, number> };
    };
    stages: Partial<Record<import("@placement/shared").DecisionStage, {
      status: import("@placement/shared").StageStatus;
      remarks: string | null;
      selected: number;
      rejected: number;
      pending: number;
    }>>;
    companySheetUrl: string | null;
    psmOwner: PersonRef | null;
    process: { phase: CompanyProcessPhase; label: string; roundId: string | null; updatedAt: string | null };
    /** Latest saved company-sheet import for this job. */
    companyImport: { id: string; batchCode: string; committedAt: string | null; sourceUrl: string | null } | null;
    companyPipeline: { status: string; count: number }[];
    companyRounds: { id: string; name: string; sequence: number; scheduled: number; cleared: number; rejected: number; onHold: number; noShow: number }[];
    products: {
      id: string;
      name: string;
      category: string;
      applicants: number;
      resumeShortlisted: number;
      screeningShortlisted: number;
      assignmentShortlisted: number;
      finalShortlisted: number;
      inPool: number;
      poolFinalShortlisted: number;
    }[];
    batches: {
      id: string;
      name: string;
      sequence: number;
      status: "ACTIVE" | "CLOSED";
      applications: number;
      stages: Record<"RESUME_SHORTLIST" | "SCREENING_SHORTLIST" | "ASSIGNMENT_SHORTLIST" | "FINAL_SHORTLIST", {
        selected: number;
        rejected: number;
        pending: number;
        onHold: number;
        noShow: number;
        withdrawn: number;
      }>;
      products: {
        id: string;
        name: string;
        category: string;
        applicants: number;
        resumeShortlisted: number;
        screeningShortlisted: number;
        assignmentShortlisted: number;
        finalShortlisted: number;
        inPool: number;
        poolFinalShortlisted: number;
      }[];
      sourceRows: number | null;
      excludedRows: number | null;
      importBatchId: string | null;
      importBatchCode: string | null;
      importedAt: string | null;
    }[];
    additionalProfiles: { classification: string; count: number }[];
    selectionBasisBreakdown: { selectionBasis: string; count: number }[];
  }[];
}

export interface CompanyJobCandidates {
  page: number;
  pageSize: number;
  total: number;
  items: {
    candidateId: string;
    recruitmentBatchId: string;
    recruitmentBatchName: string;
    candidateCode: string;
    fullName: string;
    mobile: string | null;
    category: string | null;
    product: { name: string; category: string } | null;
    assessedPool: {
      processType: string;
      isCompetencyPoolMember: boolean;
      competencyLevel: string | null;
      category: string | null;
      bucketTier: string | null;
      tr1Status: string | null;
      tr2Status: string | null;
      competencyStatus: string | null;
    } | null;
    resumeUrl: string | null;
    skills: string[];
    resumeAssessment: { scores: unknown; skills: unknown; projects: unknown } | null;
    additionalProfiles: { classification: string; sourceSheet: string; data: unknown }[];
    shareStatus: import("@placement/shared").CompanyShareStatus;
    pipelineStatus: import("@placement/shared").PipelineStatus | null;
    guidance: { status: string; tone: import("@placement/shared").SupportTone; doneOn: string | null; contributors: string[] } | null;
    rsa: { status: string; tone: import("@placement/shared").SupportTone; doneOn: string | null; contributors: string[] } | null;
    outcomes: {
      stage: import("@placement/shared").DecisionStage;
      outcome: import("@placement/shared").StageOutcome;
      selectionBasis: string | null;
      priority: string | null;
      techScore: number | null;
      commScore: number | null;
      rejectionReason: string | null;
      remarks: string | null;
    }[];
  }[];
}

export interface UserAccessRecord {
  id: string;
  fullName: string;
  email: string;
  teamId: string | null;
  createdAt: string;
  roles: { role: { code: string } }[];
}

export interface SheetTab {
  sheetId: number;
  title: string;
  index: number;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

export interface SheetHeader {
  column: number;
  header: string;
  sample: string;
  value: string;
}

export interface SheetTabMapping {
  id: string;
  workflowStage: string;
  sheetId: number;
  sheetTitle: string;
  headerRow: number;
  columnMapping: Record<string, string> | null;
}

export interface SheetConnection {
  id: string;
  title: string;
  sourceType: string;
  teamId: string | null;
  team: { id: string; name: string } | null;
  tabMappings: SheetTabMapping[];
  createdAt: string;
}

export interface SheetSetup {
  connections: SheetConnection[];
  workflowStages: string[];
  columnKeys: string[];
  googleServiceAccountEmail: string | null;
}

export interface DashboardFilters {
  from?: string;
  to?: string;
  productId?: string;
  skill?: string;
}

export interface CatalogOption {
  id: string;
  name: string;
}

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface ProductOption extends CatalogOption {
  code: string;
  category: "ACADEMY" | "ACADEMY_INTENSIVE" | "EXTERNAL";
}

export interface OwnerOption extends PersonRef {
  team: { name: string } | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: PersonRef | null;
}

export type CompanyStatus = "ACTIVE" | "INACTIVE";

export interface CompanyListItem {
  id: string;
  name: string;
  hubspotCompanyId: string | null;
  hubspotUrl: string | null;
  industry: string | null;
  location: string | null;
  status: CompanyStatus;
  updatedAt: string;
  openJobRequests: number;
  openPositions: number;
  psmOwners: PersonRef[];
  processes: { jobRequestId: string; roleTitle: string; phase: CompanyProcessPhase; label: string }[];
}

export interface CompanyDetail {
  id: string;
  name: string;
  hubspotCompanyId: string | null;
  hubspotUrl: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  notes: string | null;
  status: CompanyStatus;
  createdAt: string;
  createdBy: PersonRef;
  canEdit: boolean;
  canDelete: boolean;
  jobRequests: {
    id: string;
    jobId: string;
    roleTitle: string;
    openings: number;
    status: JobRequestStatus;
    requestDate: string;
    deadline: string | null;
    psmOwner: PersonRef | null;
    processPhase: CompanyProcessPhase;
    processPhaseAt: string | null;
    processRound: { id: string; name: string } | null;
    processLabel: string;
    interviewRounds: { id: string; name: string }[];
  }[];
  history: AuditEntry[];
}

export type { JobRequestStatus };

export interface JobRequestListItem {
  id: string;
  jobId: string;
  roleTitle: string;
  openings: number;
  requiredCandidateCount: number;
  ctcLpa: number | null;
  requestDate: string;
  deadline: string | null;
  status: JobRequestStatus;
  processPhase: CompanyProcessPhase;
  processLabel: string;
  company: { id: string; name: string };
  psmOwner: PersonRef | null;
  techStack: string[];
  eligibleProducts: { id: string; code: string; name: string }[];
}

export interface JobRequestDetail {
  id: string;
  jobId: string;
  hubspotDealId: string | null;
  hubspotDealUrl: string | null;
  roleTitle: string;
  openings: number;
  requiredCandidateCount: number;
  ctcLpa: number | null;
  description: string;
  requestDate: string;
  deadline: string | null;
  status: JobRequestStatus;
  timeline: string | null;
  shortlistingMechanism: string | null;
  companyRemarks: string | null;
  companySheetUrl: string | null;
  internalSheetUrl: string | null;
  createdAt: string;
  company: { id: string; name: string; hubspotCompanyId: string | null; hubspotUrl: string | null };
  psmOwner: (PersonRef & { email: string }) | null;
  createdBy: PersonRef;
  skills: { isMandatory: boolean; skill: { id: string; name: string } }[];
  eligibleProducts: { product: ProductOption }[];
  assignments: {
    id: string;
    assignedAt: string;
    endedAt: string | null;
    notes: string | null;
    assignedTo: PersonRef;
    assignedBy: PersonRef | null;
  }[];
  allowedTransitions: JobRequestStatus[];
  canEdit: boolean;
  canReassign: boolean;
  canDelete: boolean;
  history: AuditEntry[];
  recruitmentBatches: RecruitmentBatchSummary[];
}

export interface RecruitmentBatchSummary {
  id: string;
  name: string;
  sequence: number;
  status: "ACTIVE" | "CLOSED";
  openings: number | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Null: the batch reads the job request's sheet. */
  internalSheetUrl: string | null;
  companySheetUrl: string | null;
  internalTabs: BatchTabs | null;
  createdAt: string;
}

export const BATCH_TAB_CODES = ["TA", "RS", "SC", "AS", "SP"] as const;
export type BatchTabCode = (typeof BATCH_TAB_CODES)[number];
/** Which tab of the internal sheet is TA / RS / SC / AS / SP for a batch. */
export type BatchTabs = Partial<Record<BatchTabCode, string | null>>;

export interface RecruitmentBatchInput {
  name?: string;
  openings?: number | null;
  status?: "ACTIVE" | "CLOSED";
  internalSheetUrl?: string | null;
  companySheetUrl?: string | null;
  internalTabs?: BatchTabs | null;
}

export interface InternalSheetTabs {
  url: string;
  title: string;
  tabs: string[];
  suggested: BatchTabs;
  current: BatchTabs | null;
  /** Tab name → the other batch that already reads it. */
  usedBy: Record<string, string>;
}

export interface JobRequestInput {
  jobId: string;
  hubspotDeal: string | null;
  companyId: string;
  roleTitle: string;
  techStack: string[];
  openings: number;
  requiredCandidateCount: number;
  ctcLpa: number | null;
  description: string;
  requestDate: string;
  deadline: string | null;
  timeline: string | null;
  shortlistingMechanism: string | null;
  companyRemarks: string | null;
  companySheetUrl: string | null;
  internalSheetUrl: string | null;
  eligibleProductIds: string[];
  psmOwnerId?: string;
  status?: "DRAFT" | "OPEN";
}

export interface CompanyInput {
  name: string;
  hubspotCompany: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  notes: string | null;
  status?: CompanyStatus;
}
