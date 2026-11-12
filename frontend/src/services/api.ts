import { IDEMPOTENCY_HEADER, type ApiErrorBody, type CompanyProcessPhase, type PaginationMeta } from "@placement/shared";
import type {
  AuthUser,
  CatalogOption,
  CompanyDetail,
  CompanyAnalytics,
  PlacementKpis,
  CompanyInput,
  CompanyListItem,
  CompanyJobCandidates,
  InternalSheetTabs,
  JobRequestDetail,
  RecruitmentBatchInput,
  JobRequestInput,
  JobRequestListItem,
  JobRequestStatus,
  OwnerOption,
  ProductOption,
  DashboardFilters,
  DashboardSummary,
  SheetConnection,
  SheetHeader,
  SheetSetup,
  SheetTab,
  SheetTabMapping,
  UserAccessRecord,
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionExpired: () => void = () => undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A fresh key per user action; reuse it only when retrying that same action. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

function isApiErrorResponse(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string" &&
    "code" in value.error &&
    typeof value.error.code === "string"
  );
}

async function readError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  if (isApiErrorResponse(body)) {
    return new ApiError(body.error.message, response.status, body.error.code, body.error.requestId);
  }
  return new ApiError("The request could not be completed.", response.status, "REQUEST_FAILED");
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });

    if (response.status === 401) {
      setAccessToken(null);
      return false;
    }

    if (!response.ok) {
      throw await readError(response);
    }

    const body = (await response.json()) as { data: { accessToken: string } };
    setAccessToken(body.data.accessToken);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export type RequestOptions = RequestInit & { idempotencyKey?: string };

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  retryAfterRefresh = true,
): Promise<T> {
  const { idempotencyKey, ...init } = options;
  const headers = new Headers(init.headers);
  if (idempotencyKey) {
    headers.set(IDEMPOTENCY_HEADER, idempotencyKey);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retryAfterRefresh && path !== "/auth/login") {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(path, options, false);
    }
    onSessionExpired();
  }

  if (!response.ok) {
    throw await readError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function requestBlob(path: string, retryAfterRefresh = true): Promise<Blob> {
  const headers = new Headers();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retryAfterRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return requestBlob(path, false);
    }
    onSessionExpired();
  }

  if (!response.ok) {
    throw await readError(response);
  }

  return response.blob();
}

export const authApi = {
  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const response = await request<{ data: { accessToken: string; user: AuthUser } }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    setAccessToken(response.data.accessToken);
    return response.data;
  },

  async refresh(): Promise<{ accessToken: string; user: AuthUser } | null> {
    const response = await refreshAccessToken();
    if (!response) {
      return null;
    }

    if (!accessToken) {
      return null;
    }

    const me = await request<{ data: { user: AuthUser } }>("/auth/me", {}, false);
    return { accessToken, user: me.data.user };
  },

  async logout(): Promise<void> {
    try {
      await request<void>("/auth/logout", { method: "POST" }, false);
    } finally {
      setAccessToken(null);
    }
  },

  me(): Promise<{ data: { user: AuthUser } }> {
    return request("/auth/me");
  },
};

export function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return search ? `?${search}` : "";
}

export const dashboardApi = {
  async getSummary(filters: DashboardFilters = {}): Promise<DashboardSummary> {
    const response = await request<{ data: DashboardSummary }>(`/dashboard/summary${toQueryString({ ...filters })}`);
    return response.data;
  },
  async getPlacementKpis(range: { from?: string; to?: string } = {}): Promise<PlacementKpis> {
    const response = await request<{ data: PlacementKpis }>(`/dashboard/placement-kpis${toQueryString(range)}`);
    return response.data;
  },
  async getCompanyAnalytics(companyId: string): Promise<CompanyAnalytics> {
    const response = await request<{ data: CompanyAnalytics }>(`/dashboard/companies/${companyId}/analytics`);
    return response.data;
  },
  async getCompanyJobCandidates(
    companyId: string,
    jobId: string,
    page: number,
    pageSize = 25,
    recruitmentBatchId?: string,
    filters: { stage?: string; outcome?: string; q?: string } = {},
  ): Promise<CompanyJobCandidates> {
    const response = await request<{ data: CompanyJobCandidates }>(
      `/dashboard/companies/${companyId}/jobs/${jobId}/candidates${toQueryString({
        page: String(page),
        pageSize: String(pageSize),
        recruitmentBatchId,
        stage: filters.stage,
        outcome: filters.outcome,
        q: filters.q,
      })}`,
    );
    return response.data;
  },
};

export interface AssessedPoolAnalytics {
  total: number;
  academyCandidates: number;
  processTypes: { OLD: number; NEW: number; UNKNOWN: number };
  buckets: { A: number; B: number; C: number; other: number };
  tr: {
    tr1Cleared: number;
    tr2Cleared: number;
    bothCleared: number;
    tr1StatusCounts: { value: string; count: number }[];
    tr2StatusCounts: { value: string; count: number }[];
  };
  competency: {
    included: number;
    statusCounts: { value: string; count: number }[];
    levelCounts: { value: string; count: number }[];
  };
  competencies: {
    code: string;
    title: string;
    assessedCount: number;
    scoredCount: number;
    averageScore: number | null;
    verdictCounts: { value: string; count: number }[];
    clearanceCounts: { value: string; count: number }[];
    levelCounts: { value: string; count: number }[];
  }[];
  spReasons: { value: string; count: number }[];
  spChecks: {
    roleRankCounts: { value: string; count: number }[];
    finalPoolCounts: { value: string; count: number }[];
  };
  availableFields: {
    bucketTier: boolean;
    tr1Status: boolean;
    tr2Status: boolean;
    competencyStatus: boolean;
    competencyLevel: boolean;
    spReason: boolean;
    roleRankCheck: boolean;
    finalPoolCheck: boolean;
  };
  latestImport: {
    id: string;
    sourceFileName: string;
    sourceSheet: string;
    rowCount: number;
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    mappedFields: string[];
    createdAt: string;
    importedBy: string;
  } | null;
}

export interface AssessedPoolLookupResult {
  status: "ASSESSED";
  id: string;
  userId: string | null;
  name: string | null;
  mobile: string | null;
  processType: "OLD" | "NEW" | "UNKNOWN" | null;
  category: "ACADEMY" | null;
  bucketTier: string | null;
  tr1Status: string | null;
  tr2Status: string | null;
  isCompetencyPoolMember: boolean;
  competencyLevel: string | null;
  competencyStatus: string | null;
  spReason: string | null;
  sourceData: Record<string, {
    rowNumber?: number;
    columns?: { column: number; header: string; value: string; link?: string }[];
    competencies?: {
      code: string;
      title: string;
      score: number | null;
      verdictBand: string | null;
      clearanceStatus: string | null;
      level: string | null;
    }[];
    rows?: {
      rowNumber: number;
      columns: { column: number; header: string; value: string; link?: string }[];
      competencies?: {
        code: string;
        title: string;
        score: number | null;
        verdictBand: string | null;
        clearanceStatus: string | null;
        level: string | null;
      }[];
    }[];
  }> | null;
}

export interface AssessedPoolColumn {
  column: number;
  header: string;
  sample: string;
}

export interface AssessedPoolWorkbookPreview {
  fileName: string;
  sheets: { name: string; rowCount: number; columnCount: number }[];
  selectedSheet: string | null;
  headerRow: number;
  headers: AssessedPoolColumn[];
}

export interface AssessedPoolImportResult {
  importId: string;
  sourceFileName: string;
  rowCount: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  skippedMissingMobile: number;
  skippedInvalidMobile: number;
  skippedDuplicateMobile: number;
  mergedDuplicateMobile: number;
}

const poolFileQuery = (fileName: string, sheet?: string, mapping?: Record<string, number>) => {
  const query = new URLSearchParams({ fileName });
  if (sheet) query.set("sheet", sheet);
  if (mapping) query.set("mapping", JSON.stringify(mapping));
  return `?${query.toString()}`;
};

const poolFileHeaders = (file: File) => ({
  "Content-Type": file.type || (/\.csv$/i.test(file.name) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
});

export interface AssessedPoolSource {
  id: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  sheetTitles: string[];
  lastSyncedAt: string | null;
  mappedFields: string[];
}

export interface AssessedPoolSourcePreview extends Omit<AssessedPoolWorkbookPreview, "fileName"> {
  spreadsheetTitle: string;
}

export interface AssessedPoolSourceSyncResult {
  source: AssessedPoolSource;
  import: AssessedPoolImportResult;
}

export const assessedPoolApi = {
  async analytics(): Promise<AssessedPoolAnalytics> {
    return (await request<{ data: AssessedPoolAnalytics }>("/assessed-pool/analytics")).data;
  },
  async lookup(search: string): Promise<{ results: AssessedPoolLookupResult[]; limit: number }> {
    const query = new URLSearchParams({ search }).toString();
    return (await request<{ data: { results: AssessedPoolLookupResult[]; limit: number } }>(`/assessed-pool/lookup?${query}`)).data;
  },
  async getSource(): Promise<AssessedPoolSource | null> {
    return (await request<{ data: AssessedPoolSource | null }>("/assessed-pool/source")).data;
  },
  async previewSource(url: string, sheetTitle?: string): Promise<AssessedPoolSourcePreview> {
    return (await request<{ data: AssessedPoolSourcePreview }>("/assessed-pool/source/preview", {
      method: "POST",
      body: JSON.stringify({ url, ...(sheetTitle ? { sheetTitle } : {}) }),
    })).data;
  },
  async connectSource(url: string): Promise<AssessedPoolSourceSyncResult> {
    return (await request<{ data: AssessedPoolSourceSyncResult }>("/assessed-pool/source", {
      method: "PUT",
      body: JSON.stringify({ url }),
      idempotencyKey: newIdempotencyKey(),
    })).data;
  },
  async syncSource(): Promise<AssessedPoolSourceSyncResult> {
    return (await request<{ data: AssessedPoolSourceSyncResult }>("/assessed-pool/source/sync", {
      method: "POST",
      idempotencyKey: newIdempotencyKey(),
    })).data;
  },
  async disconnectSource(): Promise<void> {
    await request("/assessed-pool/source", { method: "DELETE" });
  },
  async deleteImport(importId: string): Promise<{ removedRecords: number }> {
    return (await request<{ data: { removedRecords: number } }>(`/assessed-pool/imports/${importId}`, { method: "DELETE" })).data;
  },
  async clearAll(): Promise<{ removedRecords: number; removedImports: number }> {
    return (await request<{ data: { removedRecords: number; removedImports: number } }>("/assessed-pool/records", { method: "DELETE" })).data;
  },
  async preview(file: File, sheet?: string): Promise<AssessedPoolWorkbookPreview> {
    return (await request<{ data: AssessedPoolWorkbookPreview }>(
      `/assessed-pool/preview${poolFileQuery(file.name, sheet)}`,
      { method: "POST", body: file, headers: poolFileHeaders(file) },
    )).data;
  },
  async importFile(file: File, sheet: string, mapping: Record<string, number>): Promise<AssessedPoolImportResult> {
    return (await request<{ data: AssessedPoolImportResult }>(
      `/assessed-pool/imports${poolFileQuery(file.name, sheet, mapping)}`,
      { method: "POST", body: file, headers: poolFileHeaders(file), idempotencyKey: newIdempotencyKey() },
    )).data;
  },
};

export const catalogApi = {
  async products(): Promise<ProductOption[]> {
    const response = await request<{ data: { products: ProductOption[] } }>("/catalog/products");
    return response.data.products;
  },

  async owners(): Promise<OwnerOption[]> {
    const response = await request<{ data: { owners: OwnerOption[] } }>("/catalog/owners");
    return response.data.owners;
  },

  async skills(): Promise<(CatalogOption & { normalizedName: string })[]> {
    const response = await request<{ data: { skills: (CatalogOption & { normalizedName: string })[] } }>("/catalog/skills");
    return response.data.skills;
  },
};

export type UserRoleCode = "ADMIN" | "MANAGER" | "STAKEHOLDER" | "EMPLOYEE";

export const usersApi = {
  async list(): Promise<UserAccessRecord[]> {
    const response = await request<{ data: { users: UserAccessRecord[] } }>("/teams/users");
    return response.data.users;
  },

  async createUser(input: {
    email: string;
    fullName: string;
    password: string;
    role: "ADMIN" | "MANAGER" | "STAKEHOLDER" | "EMPLOYEE";
  }, idempotencyKey = newIdempotencyKey()): Promise<void> {
    await request("/teams/users", { method: "POST", body: JSON.stringify(input), idempotencyKey });
  },

  async updateUser(userId: string, input: { email?: string; fullName?: string; role?: UserRoleCode }): Promise<void> {
    await request(`/teams/users/${userId}`, { method: "PATCH", body: JSON.stringify(input), idempotencyKey: newIdempotencyKey() });
  },

  /** No idempotency key on purpose: the response holds the new password and must not be stored for replay. */
  async resetPassword(userId: string, password?: string): Promise<{ password: string }> {
    const response = await request<{ data: { password: string } }>(`/teams/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(password ? { password } : {}),
    });
    return response.data;
  },

  async deleteUser(userId: string): Promise<void> {
    await request(`/teams/users/${userId}`, { method: "DELETE", idempotencyKey: newIdempotencyKey() });
  },
};

export const sheetsApi = {
  async remove(connectionId: string): Promise<void> {
    await request(`/sheets/${connectionId}`, { method: "DELETE" });
  },

  async list(): Promise<SheetSetup> {
    const response = await request<{ data: SheetSetup }>("/sheets");
    return response.data;
  },

  async connect(input: { url: string; sourceType: string }, idempotencyKey = newIdempotencyKey()): Promise<{
    connection: SheetConnection;
    tabs: SheetTab[];
  }> {
    const response = await request<{ data: { connection: SheetConnection; tabs: SheetTab[] } }>("/sheets", {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey,
    });
    return response.data;
  },

  async listTabs(connectionId: string): Promise<SheetTab[]> {
    const response = await request<{ data: { tabs: SheetTab[] } }>(`/sheets/${connectionId}/tabs`);
    return response.data.tabs;
  },

  async getHeaders(connectionId: string, sheetId: number): Promise<{ headerRow: number; headers: SheetHeader[] }> {
    const response = await request<{ data: { headerRow: number; headers: SheetHeader[] } }>(
      `/sheets/${connectionId}/tabs/${sheetId}/headers`,
    );
    return response.data;
  },

  async saveMapping(input: {
    connectionId: string;
    workflowStage: string;
    sheetId: number;
    sheetTitle: string;
    headerRow: number;
    columnMapping: Record<string, string>;
  }): Promise<SheetTabMapping> {
    const { connectionId, ...body } = input;
    const response = await request<{ data: { mapping: SheetTabMapping } }>(
      `/sheets/${connectionId}/mappings`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return response.data.mapping;
  },

  async syncAssessedPools(connectionId: string): Promise<{
    counts: { BUCKET: number; TR: number; COMPETENCY: number };
    matchedCandidates: number;
  }> {
    const response = await request<{ data: { counts: { BUCKET: number; TR: number; COMPETENCY: number }; matchedCandidates: number } }>(
      `/sheets/${connectionId}/pools/sync`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return response.data;
  },
};

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface CompanyListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
}

export const companiesApi = {
  async options(params: { search?: string; status?: "ACTIVE" | "INACTIVE" } = {}): Promise<{ id: string; name: string; location: string | null }[]> {
    const response = await request<{ data: { companies: { id: string; name: string; location: string | null }[] } }>(
      `/companies/options${toQueryString(params)}`,
    );
    return response.data.companies;
  },

  async list(params: CompanyListParams = {}): Promise<Page<CompanyListItem>> {
    const response = await request<{ data: { companies: CompanyListItem[] }; meta: PaginationMeta }>(
      `/companies${toQueryString({ ...params, page: params.page?.toString(), pageSize: params.pageSize?.toString() })}`,
    );
    return { items: response.data.companies, meta: response.meta };
  },

  async get(companyId: string): Promise<CompanyDetail> {
    const response = await request<{ data: { company: CompanyDetail } }>(`/companies/${companyId}`);
    return response.data.company;
  },

  async create(input: CompanyInput, idempotencyKey = newIdempotencyKey()): Promise<{ id: string; name: string }> {
    const response = await request<{ data: { company: { id: string; name: string } } }>("/companies", {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey,
    });
    return response.data.company;
  },

  async update(companyId: string, input: Partial<CompanyInput>): Promise<void> {
    await request(`/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(input) });
  },

  async delete(companyId: string): Promise<void> {
    await request(`/companies/${companyId}`, { method: "DELETE", idempotencyKey: newIdempotencyKey() });
  },
};

export interface JobRequestListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  view?: "active" | "closed" | "all";
  companyId?: string;
  ownerId?: string;
  /** Hiring status with the company; `round` narrows a round phase to one round name. */
  process?: CompanyProcessPhase;
  round?: string;
}

/** Jobs at one hiring status (round phases split by round name), for the list's status filter. */
export interface ProcessSummaryGroup {
  phase: CompanyProcessPhase;
  round: string | null;
  label: string;
  count: number;
}

export const jobRequestsApi = {
  async list(params: JobRequestListParams = {}): Promise<Page<JobRequestListItem>> {
    const response = await request<{ data: { jobRequests: JobRequestListItem[] }; meta: PaginationMeta }>(
      `/job-requests${toQueryString({ ...params, page: params.page?.toString(), pageSize: params.pageSize?.toString() })}`,
    );
    return { items: response.data.jobRequests, meta: response.meta };
  },

  async processSummary(params: Pick<JobRequestListParams, "search" | "view">): Promise<ProcessSummaryGroup[]> {
    return (await request<{ data: { groups: ProcessSummaryGroup[] } }>(`/job-requests/process-summary${toQueryString(params)}`)).data.groups;
  },

  async get(jobRequestId: string): Promise<JobRequestDetail> {
    const response = await request<{ data: { jobRequest: JobRequestDetail } }>(`/job-requests/${jobRequestId}`);
    return response.data.jobRequest;
  },

  async createRecruitmentBatch(jobRequestId: string, input: RecruitmentBatchInput & { name: string }): Promise<{ id: string; name: string; sequence: number }> {
    const response = await request<{ data: { recruitmentBatch: { id: string; name: string; sequence: number } } }>(`/job-requests/${jobRequestId}/recruitment-batches`, {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey: newIdempotencyKey(),
    });
    return response.data.recruitmentBatch;
  },

  async updateRecruitmentBatch(jobRequestId: string, batchId: string, input: RecruitmentBatchInput): Promise<{ id: string; name: string }> {
    const response = await request<{ data: { recruitmentBatch: { id: string; name: string } } }>(`/job-requests/${jobRequestId}/recruitment-batches/${batchId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      idempotencyKey: newIdempotencyKey(),
    });
    return response.data.recruitmentBatch;
  },

  /** Deletes a batch with no saved data; the API refuses (409) when it has applicants, rounds or saved imports. */
  async deleteRecruitmentBatch(jobRequestId: string, batchId: string): Promise<void> {
    await request(`/job-requests/${jobRequestId}/recruitment-batches/${batchId}`, { method: "DELETE", idempotencyKey: newIdempotencyKey() });
  },

  /** Tabs of the internal sheet a batch reads (its own, else the job request's), with suggestions. */
  async internalSheetTabs(jobRequestId: string, batchId?: string, url?: string): Promise<InternalSheetTabs> {
    const response = await request<{ data: InternalSheetTabs }>(`/job-requests/${jobRequestId}/internal-sheet/tabs${toQueryString({ batchId, url })}`);
    return response.data;
  },

  async create(input: JobRequestInput, idempotencyKey = newIdempotencyKey()): Promise<{ id: string }> {
    const response = await request<{ data: { jobRequest: { id: string } } }>("/job-requests", {
      method: "POST",
      body: JSON.stringify(input),
      idempotencyKey,
    });
    return response.data.jobRequest;
  },

  async update(jobRequestId: string, input: Partial<JobRequestInput>): Promise<JobRequestDetail> {
    const response = await request<{ data: { jobRequest: JobRequestDetail } }>(`/job-requests/${jobRequestId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return response.data.jobRequest;
  },

  async delete(jobRequestId: string): Promise<void> {
    await request(`/job-requests/${jobRequestId}`, { method: "DELETE", idempotencyKey: newIdempotencyKey() });
  },

  async changeStatus(jobRequestId: string, status: JobRequestStatus, reason?: string): Promise<JobRequestDetail> {
    const response = await request<{ data: { jobRequest: JobRequestDetail } }>(`/job-requests/${jobRequestId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
    });
    return response.data.jobRequest;
  },

  async reassign(jobRequestId: string, psmOwnerId: string, notes?: string): Promise<JobRequestDetail> {
    const response = await request<{ data: { jobRequest: JobRequestDetail } }>(`/job-requests/${jobRequestId}/owner`, {
      method: "POST",
      body: JSON.stringify({ psmOwnerId, ...(notes ? { notes } : {}) }),
    });
    return response.data.jobRequest;
  },
};
