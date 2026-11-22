import type {
  CrmRemark,
  CrmRemarkInput,
  DriveNotes,
  MonthlyPipeline,
  PipelineEntryInput,
  RsaFilters,
  RsaReportInput,
  RsaReview,
  RsaWorklist,
} from "../types/pulse";
import { newIdempotencyKey, request, toQueryString } from "./api";

type Data<T> = { data: T };
const json = (method: string, body: unknown, idempotencyKey?: string) => ({
  method,
  body: JSON.stringify(body),
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

export const monthlyPipelineApi = {
  async month(month: string): Promise<MonthlyPipeline> {
    return (await request<Data<MonthlyPipeline>>(`/monthly-pipeline${toQueryString({ month })}`)).data;
  },
  async create(input: PipelineEntryInput & { month: string; jobRequestId: string }): Promise<void> {
    await request("/monthly-pipeline/entries", json("POST", input, newIdempotencyKey()));
  },
  async update(entryId: string, input: PipelineEntryInput): Promise<void> {
    await request(`/monthly-pipeline/entries/${entryId}`, json("PATCH", input));
  },
  async remove(entryId: string): Promise<void> {
    await request(`/monthly-pipeline/entries/${entryId}`, { method: "DELETE" });
  },
  async carryForward(fromMonth: string, entryIds?: string[]): Promise<{ carried: number; skipped: number; toMonth: string }> {
    return (await request<Data<{ carried: number; skipped: number; toMonth: string }>>("/monthly-pipeline/carry-forward", json("POST", { fromMonth, ...(entryIds ? { entryIds } : {}) }, newIdempotencyKey()))).data;
  },
};

export const driveNotesApi = {
  async get(jobRequestId: string): Promise<DriveNotes> {
    return (await request<Data<DriveNotes>>(`/job-requests/${jobRequestId}/drive-notes`)).data;
  },
  async addRemark(jobRequestId: string, input: CrmRemarkInput): Promise<CrmRemark> {
    return (await request<Data<{ remark: CrmRemark }>>(`/job-requests/${jobRequestId}/drive-notes/crm-remarks`, json("POST", input, newIdempotencyKey()))).data.remark;
  },
  async updateRemark(jobRequestId: string, remarkId: string, input: CrmRemarkInput): Promise<CrmRemark> {
    return (await request<Data<{ remark: CrmRemark }>>(`/job-requests/${jobRequestId}/drive-notes/crm-remarks/${remarkId}`, json("PUT", input))).data.remark;
  },
  async deleteRemark(jobRequestId: string, remarkId: string): Promise<void> {
    await request(`/job-requests/${jobRequestId}/drive-notes/crm-remarks/${remarkId}`, { method: "DELETE" });
  },
  async saveRsaReview(jobRequestId: string, input: Partial<Pick<RsaReview, "wentRight" | "wentWrong" | "actionItems">>): Promise<RsaReview> {
    return (await request<Data<{ rsaReview: RsaReview }>>(`/job-requests/${jobRequestId}/drive-notes/rsa-review`, json("PUT", input))).data.rsaReview;
  },
};

export const rsaApi = {
  async students(filters: RsaFilters): Promise<RsaWorklist> {
    return (await request<Data<RsaWorklist>>(`/rsa/students${toQueryString({ ...filters })}`)).data;
  },
  /** The RSA team's reason why the company did not select the student; null clears it. */
  async setReason(applicationId: string, rejectionTagId: string | null): Promise<void> {
    await request(`/rsa/applications/${applicationId}/reason`, json("PUT", { rejectionTagId }));
  },
  async saveReport(applicationId: string, input: RsaReportInput): Promise<void> {
    await request(`/rsa/applications/${applicationId}/report`, json("PUT", input));
  },
};
