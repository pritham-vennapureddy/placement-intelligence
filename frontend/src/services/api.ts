import { IDEMPOTENCY_HEADER, type ApiErrorBody, type PaginationMeta } from "@placement/shared";
import type {
  AuthUser,
  CatalogOption,
  CompanyDetail,
  CompanyInput,
  CompanyListItem,
  JobRequestDetail,
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
  TeamRecord,
  TeamUserOption,
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

type RequestOptions = RequestInit & { idempotencyKey?: string };

async function request<T>(
  path: string,
  options: RequestOptions = {},
  retryAfterRefresh = true,
): Promise<T> {
  const { idempotencyKey, ...init } = options;
  const headers = new Headers(init.headers);
  if (idempotencyKey) {
    headers.set(IDEMPOTENCY_HEADER, idempotencyKey);
  }
  if (init.body && !headers.has("Content-Type")) {
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

function toQueryString(params: Record<string, string | undefined>): string {
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

export const teamsApi = {
  async list(): Promise<TeamRecord[]> {
    const response = await request<{ data: { teams: TeamRecord[] } }>("/teams");
    return response.data.teams;
  },

  async listUsers(): Promise<TeamUserOption[]> {
    const response = await request<{ data: { users: TeamUserOption[] } }>("/teams/users");
    return response.data.users;
  },

  async create(name: string, idempotencyKey = newIdempotencyKey()): Promise<TeamRecord> {
    const response = await request<{ data: { team: TeamRecord } }>("/teams", {
      method: "POST",
      body: JSON.stringify({ name }),
      idempotencyKey,
    });
    return response.data.team;
  },

  async createUser(input: {
    email: string;
    fullName: string;
    password: string;
    role: "MANAGER" | "PSM";
    teamId?: string;
  }, idempotencyKey = newIdempotencyKey()): Promise<void> {
    await request("/teams/users", { method: "POST", body: JSON.stringify(input), idempotencyKey });
  },

  async updateMembers(teamId: string, input: { teamLeadId: string | null; psmIds: string[] }): Promise<TeamRecord> {
    const response = await request<{ data: { team: TeamRecord } }>(`/teams/${teamId}/members`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
    return response.data.team;
  },
};

export const sheetsApi = {
  async list(): Promise<SheetSetup> {
    const response = await request<{ data: SheetSetup }>("/sheets");
    return response.data;
  },

  async connect(input: { url: string; sourceType: string; teamId?: string }, idempotencyKey = newIdempotencyKey()): Promise<{
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

  async getHeaders(connectionId: string, sheetId: number, row: number): Promise<SheetHeader[]> {
    const response = await request<{ data: { headers: SheetHeader[] } }>(
      `/sheets/${connectionId}/tabs/${sheetId}/headers?row=${row}`,
    );
    return response.data.headers;
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
};

export interface JobRequestListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  view?: "active" | "closed" | "all";
  companyId?: string;
  ownerId?: string;
}

export const jobRequestsApi = {
  async list(params: JobRequestListParams = {}): Promise<Page<JobRequestListItem>> {
    const response = await request<{ data: { jobRequests: JobRequestListItem[] }; meta: PaginationMeta }>(
      `/job-requests${toQueryString({ ...params, page: params.page?.toString(), pageSize: params.pageSize?.toString() })}`,
    );
    return { items: response.data.jobRequests, meta: response.meta };
  },

  async get(jobRequestId: string): Promise<JobRequestDetail> {
    const response = await request<{ data: { jobRequest: JobRequestDetail } }>(`/job-requests/${jobRequestId}`);
    return response.data.jobRequest;
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

