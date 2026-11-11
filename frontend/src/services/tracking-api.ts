import type { CompanyProcessPhase, PaginationMeta, StudentSupportKind } from "@placement/shared";
import type { GuidanceJobOption, GuidanceView, InsightFilters, Insights, JobTracking, MyWork, StudentInsight, StudentInsightsPage, StudentStatusFilter, StudentSupportInput, SupportStatusOption } from "../types/tracking";
import { newIdempotencyKey, request, toQueryString } from "./api";

type Data<T> = { data: T };
const json = (method: string, body: unknown, idempotencyKey?: string) => ({
  method,
  body: JSON.stringify(body),
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

export const trackingApi = {
  async job(jobRequestId: string): Promise<JobTracking> {
    return (await request<Data<JobTracking>>(`/job-requests/${jobRequestId}/tracking`)).data;
  },
  async setProcessStatus(jobRequestId: string, input: { phase: CompanyProcessPhase; roundId?: string | null; notes?: string }): Promise<void> {
    await request(`/job-requests/${jobRequestId}/tracking/process-status`, json("PUT", input));
  },
  async myWork(ownerId?: string): Promise<MyWork> {
    return (await request<Data<MyWork>>(`/my-work${toQueryString({ ownerId })}`)).data;
  },
};

export const guidanceApi = {
  async searchJobs(q?: string): Promise<GuidanceJobOption[]> {
    return (await request<Data<{ jobs: GuidanceJobOption[] }>>(`/guidance/jobs${toQueryString({ q: q || undefined })}`)).data.jobs;
  },
  async forJob(jobRequestId: string, students: "shortlisted" | "all" = "shortlisted"): Promise<GuidanceView> {
    return (await request<Data<GuidanceView>>(`/guidance/jobs/${jobRequestId}${toQueryString({ students: students === "all" ? "all" : undefined })}`)).data;
  },
  async addSession(jobRequestId: string, givenOn: string, notes?: string): Promise<void> {
    await request(`/guidance/jobs/${jobRequestId}/sessions`, json("POST", { givenOn, ...(notes ? { notes } : {}) }, newIdempotencyKey()));
  },
  async deleteSession(sessionId: string): Promise<void> {
    await request(`/guidance/sessions/${sessionId}`, { method: "DELETE" });
  },
  async setSupport(applicationId: string, kind: StudentSupportKind, input: StudentSupportInput): Promise<void> {
    await request(`/guidance/applications/${applicationId}/support/${kind}`, json("PUT", input));
  },
  async bulkSupport(jobRequestId: string, kind: StudentSupportKind, applicationIds: string[], input: StudentSupportInput): Promise<{ updated: number }> {
    return (await request<Data<{ updated: number }>>(`/guidance/jobs/${jobRequestId}/support`, json("PUT", { ...input, kind, applicationIds }))).data;
  },
  async clearSupport(applicationId: string, kind: StudentSupportKind): Promise<void> {
    await request(`/guidance/applications/${applicationId}/support/${kind}`, { method: "DELETE" });
  },
  async statusOptions(): Promise<SupportStatusOption[]> {
    return (await request<Data<{ statusOptions: SupportStatusOption[] }>>("/guidance/status-options")).data.statusOptions;
  },
  async createStatusOption(input: Pick<SupportStatusOption, "kind" | "label" | "tone" | "countsAsDone" | "needsContributor" | "needsNote">): Promise<SupportStatusOption> {
    return (await request<Data<{ statusOption: SupportStatusOption }>>("/guidance/status-options", json("POST", input, newIdempotencyKey()))).data.statusOption;
  },
  async updateStatusOption(optionId: string, input: Partial<Pick<SupportStatusOption, "label" | "tone" | "countsAsDone" | "needsContributor" | "needsNote">> & { restore?: true }): Promise<void> {
    await request(`/guidance/status-options/${optionId}`, json("PATCH", input));
  },
  async deleteStatusOption(optionId: string): Promise<{ removed: boolean; keptOnStudents: number }> {
    return (await request<Data<{ removed: boolean; keptOnStudents: number }>>(`/guidance/status-options/${optionId}`, { method: "DELETE" })).data;
  },
  async reorderStatusOptions(kind: StudentSupportKind, ids: string[]): Promise<void> {
    await request("/guidance/status-options/order", json("PUT", { kind, ids }));
  },
};

export const insightsApi = {
  async overview(filters: InsightFilters): Promise<Insights> {
    return (await request<Data<Insights>>(`/insights${toQueryString({ ...filters })}`)).data;
  },
  async students(filters: InsightFilters & { status?: StudentStatusFilter | undefined; q?: string | undefined; page: number; pageSize?: number }): Promise<StudentInsightsPage> {
    const response = await request<{ data: { items: StudentInsight[] }; meta: PaginationMeta }>(
      `/insights/students${toQueryString({ ...filters, page: String(filters.page), pageSize: filters.pageSize ? String(filters.pageSize) : undefined })}`,
    );
    return { items: response.data.items, meta: response.meta };
  },
};
