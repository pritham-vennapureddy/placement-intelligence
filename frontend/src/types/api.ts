import type { JobRequestStatus } from "@placement/shared";

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
  psmCount: number;
  scope: "organization" | "team" | "individual";
  teamName: string | null;
  companies: {
    id: string;
    name: string;
    jobRequests: {
      id: string;
      jobId: string;
      roleTitle: string;
      openings: number;
      status: string;
    }[];
  }[];
}

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  roles: { role: { code: string } }[];
}

export interface TeamRecord {
  id: string;
  name: string;
  teamLeadId: string | null;
  teamLead: { id: string; fullName: string; email: string; isActive: boolean } | null;
  members: TeamMember[];
  _count: { members: number; sheetConnections: number };
}

export interface TeamUserOption {
  id: string;
  fullName: string;
  email: string;
  teamId: string | null;
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
  jobRequests: {
    id: string;
    jobId: string;
    roleTitle: string;
    openings: number;
    status: JobRequestStatus;
    requestDate: string;
    deadline: string | null;
    psmOwner: PersonRef | null;
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
  requestDate: string;
  deadline: string | null;
  status: JobRequestStatus;
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
  history: AuditEntry[];
}

export interface JobRequestInput {
  jobId: string;
  hubspotDeal: string | null;
  companyId: string;
  roleTitle: string;
  techStack: string[];
  openings: number;
  requiredCandidateCount: number;
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
