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

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
