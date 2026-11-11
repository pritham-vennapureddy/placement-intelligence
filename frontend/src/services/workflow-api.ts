import type { DecisionStage, InternalStage, InterviewOutcome, PaginationMeta, PipelineStatus, RoundType, StageOutcome, StageStatus } from "@placement/shared";
import type {
  CandidateDetail,
  CandidateListItem,
  CarryOverCandidate,
  CarryOverSource,
  EligibleApplication,
  ImportBatch,
  ImportRow,
  ImportTarget,
  JobProgress,
  Paged,
  PipelineView,
  ScreeningProcess,
  StageCandidateRow,
  ValueSuggestion,
} from "../types/workflow";
import { newIdempotencyKey, request, requestBlob, toQueryString } from "./api";

type Data<T> = { data: T };
type PagedBody<K extends string, T> = { data: Record<K, T[]>; meta: PaginationMeta };

const num = (value: number | undefined) => (value === undefined ? undefined : String(value));
const json = (method: string, body: unknown, idempotencyKey?: string) => ({
  method,
  body: JSON.stringify(body),
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

export const screeningApi = {
  async get(jobRequestId: string): Promise<ScreeningProcess> {
    return (await request<Data<{ process: ScreeningProcess }>>(`/job-requests/${jobRequestId}/screening`)).data.process;
  },
  async updateNotes(jobRequestId: string, shortlistingNotes: string | null): Promise<ScreeningProcess> {
    return (await request<Data<{ process: ScreeningProcess }>>(`/job-requests/${jobRequestId}/screening`, json("PATCH", { shortlistingNotes }))).data.process;
  },
  async updateStage(
    jobRequestId: string,
    stage: InternalStage,
    input: { status?: StageStatus; statusRemarks?: string; ownerId?: string | null; nextPlannedDate?: string | null; remarks?: string | null },
  ): Promise<ScreeningProcess> {
    return (await request<Data<{ process: ScreeningProcess }>>(`/job-requests/${jobRequestId}/screening/stages/${stage}`, json("PATCH", input))).data.process;
  },
  async candidates(
    jobRequestId: string,
    stage: InternalStage,
    params: { page?: number; pageSize?: number; outcome?: StageOutcome; search?: string },
  ): Promise<Paged<StageCandidateRow>> {
    const response = await request<PagedBody<"rows", StageCandidateRow>>(
      `/job-requests/${jobRequestId}/screening/stages/${stage}/candidates${toQueryString({ ...params, page: num(params.page), pageSize: num(params.pageSize) })}`,
    );
    return { items: response.data.rows, meta: response.meta };
  },
  async decide(
    jobRequestId: string,
    stage: DecisionStage,
    applicationId: string,
    input: { outcome: StageOutcome; priority?: string | null; techScore?: number | null; commScore?: number | null; rejectionReason?: string | null; remarks?: string | null },
  ): Promise<void> {
    await request(`/job-requests/${jobRequestId}/screening/stages/${stage}/candidates/${applicationId}`, json("PUT", input));
  },
  async addToStage(jobRequestId: string, stage: DecisionStage, applicationIds: string[], outcome: StageOutcome): Promise<{ added: number; alreadyThere: number }> {
    return (await request<Data<{ added: number; alreadyThere: number }>>(
      `/job-requests/${jobRequestId}/screening/stages/${stage}/candidates`,
      json("POST", { applicationIds, outcome }, newIdempotencyKey()),
    )).data;
  },
};

export const applicationsApi = {
  async add(jobRequestId: string, input: { candidateId?: string; candidate?: { candidateCode?: string; fullName: string; email?: string; mobile?: string; productId?: string } }) {
    return (await request<Data<{ application: { id: string } }>>(`/job-requests/${jobRequestId}/applications`, json("POST", input, newIdempotencyKey()))).data.application;
  },
  async sources(jobRequestId: string): Promise<CarryOverSource[]> {
    return (await request<Data<{ jobs: CarryOverSource[] }>>(`/job-requests/${jobRequestId}/applications/carry-over/sources`)).data.jobs;
  },
  async sourceCandidates(jobRequestId: string, params: { fromJobRequestId: string; stage?: DecisionStage; outcome?: StageOutcome }): Promise<CarryOverCandidate[]> {
    return (await request<Data<{ candidates: CarryOverCandidate[] }>>(`/job-requests/${jobRequestId}/applications/carry-over/candidates${toQueryString(params)}`)).data.candidates;
  },
  async carryOver(jobRequestId: string, fromJobRequestId: string, applicationIds: string[]) {
    return (await request<Data<{ added: number; alreadyOnThisJob: number }>>(
      `/job-requests/${jobRequestId}/applications/carry-over`,
      json("POST", { fromJobRequestId, applicationIds }, newIdempotencyKey()),
    )).data;
  },
};

export const pipelineApi = {
  async get(jobRequestId: string): Promise<PipelineView> {
    return (await request<Data<{ pipeline: PipelineView }>>(`/job-requests/${jobRequestId}/pipeline`)).data.pipeline;
  },
  async eligible(jobRequestId: string): Promise<EligibleApplication[]> {
    return (await request<Data<{ applications: EligibleApplication[] }>>(`/job-requests/${jobRequestId}/pipeline/eligible`)).data.applications;
  },
  async createRound(jobRequestId: string, name: string, roundType: RoundType) {
    await request(`/job-requests/${jobRequestId}/pipeline/rounds`, json("POST", { name, roundType }, newIdempotencyKey()));
  },
  async updateRound(jobRequestId: string, roundId: string, input: { name?: string; roundType?: RoundType }) {
    await request(`/job-requests/${jobRequestId}/pipeline/rounds/${roundId}`, json("PATCH", input));
  },
  async deleteRound(jobRequestId: string, roundId: string) {
    await request(`/job-requests/${jobRequestId}/pipeline/rounds/${roundId}`, { method: "DELETE" });
  },
  async reorderRounds(jobRequestId: string, roundIds: string[]) {
    await request(`/job-requests/${jobRequestId}/pipeline/rounds/order`, json("PUT", { roundIds }));
  },
  async nominate(jobRequestId: string, applicationIds: string[], remarks?: string) {
    return (await request<Data<{ nominated: number; alreadyNominated: number }>>(
      `/job-requests/${jobRequestId}/pipeline/nominations`,
      json("POST", { applicationIds, ...(remarks ? { remarks } : {}) }, newIdempotencyKey()),
    )).data;
  },
  async changeStatus(jobRequestId: string, nominationId: string, status: PipelineStatus, date?: string, notes?: string) {
    await request(`/job-requests/${jobRequestId}/pipeline/nominations/${nominationId}/status`, json("POST", { status, ...(date ? { date } : {}), ...(notes ? { notes } : {}) }));
  },
  async withdraw(jobRequestId: string, nominationId: string, notes: string) {
    await request(`/job-requests/${jobRequestId}/pipeline/nominations/${nominationId}/withdraw`, json("POST", { notes }));
  },
  async recordInterview(
    jobRequestId: string,
    nominationId: string,
    roundId: string,
    input: { outcome: InterviewOutcome; scheduledAt?: string | null; interviewerName?: string | null; feedback?: string | null; rejectionReason?: string | null },
  ) {
    await request(`/job-requests/${jobRequestId}/pipeline/nominations/${nominationId}/interviews/${roundId}`, json("PUT", input));
  },
};

export const importsApi = {
  internalTemplate(): Promise<Blob> {
    return requestBlob("/imports/templates/internal-standard.xlsx");
  },
  async upload(jobRequestId: string, target: ImportTarget, file: File): Promise<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null }> {
    const body = new FormData();
    body.append("file", file);
    return (await request<Data<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null }>>(
      `/job-requests/${jobRequestId}/imports?target=${target}`,
      { method: "POST", body, idempotencyKey: newIdempotencyKey() },
    )).data;
  },
  async fromGoogle(jobRequestId: string, target: ImportTarget, url: string, recruitmentBatchId?: string): Promise<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null }> {
    return (await request<Data<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null }>>(
      `/job-requests/${jobRequestId}/imports/google`,
      json("POST", { target, url, ...(recruitmentBatchId ? { recruitmentBatchId } : {}) }, newIdempotencyKey()),
    )).data;
  },
  /** Re-reads the last Google Sheet used for this job; `checked` means it was mapped and checked automatically. */
  async refreshFromGoogle(jobRequestId: string, target: ImportTarget, recruitmentBatchId?: string): Promise<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null; checked: boolean }> {
    return (await request<Data<{ batch: ImportBatch; duplicateOf: { batchCode: string; committedAt: string } | null; checked: boolean }>>(
      `/job-requests/${jobRequestId}/imports/google/refresh`,
      json("POST", { target, ...(recruitmentBatchId ? { recruitmentBatchId } : {}) }, newIdempotencyKey()),
    )).data;
  },
  async googleInfo(): Promise<{ serviceAccountEmail: string | null }> {
    return (await request<Data<{ serviceAccountEmail: string | null }>>("/imports/google-info")).data;
  },
  async listForJob(jobRequestId: string): Promise<ImportBatch[]> {
    return (await request<Data<{ batches: ImportBatch[] }>>(`/job-requests/${jobRequestId}/imports`)).data.batches;
  },
  async list(page = 1): Promise<Paged<ImportBatch>> {
    const response = await request<PagedBody<"batches", ImportBatch>>(`/imports?page=${page}&pageSize=25`);
    return { items: response.data.batches, meta: response.meta };
  },
  async get(batchId: string): Promise<ImportBatch> {
    return (await request<Data<{ batch: ImportBatch }>>(`/imports/${batchId}`)).data.batch;
  },
  async preview(batchId: string, sheet: string, limit = 12): Promise<{ headerRow: number; rows: { rowNumber: number; cells: string[] }[] }> {
    return (await request<Data<{ headerRow: number; rows: { rowNumber: number; cells: string[] }[] }>>(`/imports/${batchId}/preview${toQueryString({ sheet, limit: String(limit) })}`)).data;
  },
  async values(batchId: string, sheet: string, headerRow: number, columns: number[]): Promise<ValueSuggestion[]> {
    if (columns.length === 0) return [];
    return (await request<Data<{ values: ValueSuggestion[] }>>(
      `/imports/${batchId}/values${toQueryString({ sheet, headerRow: String(headerRow), columns: columns.join(",") })}`,
    )).data.values;
  },
  async validate(batchId: string, mapping: unknown): Promise<ImportBatch> {
    return (await request<Data<{ batch: ImportBatch }>>(`/imports/${batchId}/validate`, json("POST", mapping))).data.batch;
  },
  async save(batchId: string, mapping: unknown): Promise<{ batch: ImportBatch; counts: Record<string, number> }> {
    return (await request<Data<{ batch: ImportBatch; counts: Record<string, number> }>>(
      `/imports/${batchId}/save`,
      json("POST", mapping, newIdempotencyKey()),
    )).data;
  },
  async rows(batchId: string, params: { page?: number; filter?: string; role?: string }): Promise<Paged<ImportRow>> {
    const response = await request<PagedBody<"rows", ImportRow>>(`/imports/${batchId}/rows${toQueryString({ ...params, page: num(params.page), pageSize: "50" })}`);
    return { items: response.data.rows, meta: response.meta };
  },
  async updateRow(batchId: string, rowId: string, input: { included?: boolean; applicationId?: string | null }): Promise<ImportBatch> {
    return (await request<Data<{ batch: ImportBatch }>>(`/imports/${batchId}/rows/${rowId}`, json("PATCH", input))).data.batch;
  },
  async approve(batchId: string, notes?: string): Promise<{ batch: ImportBatch; counts: Record<string, number> }> {
    return (await request<Data<{ batch: ImportBatch; counts: Record<string, number> }>>(`/imports/${batchId}/approve`, json("POST", notes ? { notes } : {}, newIdempotencyKey()))).data;
  },
  async cancel(batchId: string): Promise<ImportBatch> {
    return (await request<Data<{ batch: ImportBatch }>>(`/imports/${batchId}/cancel`, json("POST", {}))).data.batch;
  },
  async delete(batchId: string): Promise<void> {
    await request(`/imports/${batchId}`, { method: "DELETE", idempotencyKey: newIdempotencyKey() });
  },
};

export const candidatesApi = {
  async list(params: { page?: number; search?: string; category?: string; poolType?: string; poolOnly?: boolean; productId?: string; jobRequestId?: string }): Promise<Paged<CandidateListItem>> {
    const response = await request<PagedBody<"candidates", CandidateListItem>>(`/candidates${toQueryString({
      ...params,
      poolOnly: params.poolOnly ? "true" : undefined,
      page: num(params.page),
      pageSize: "25",
    })}`);
    return { items: response.data.candidates, meta: response.meta };
  },
  async get(candidateId: string): Promise<CandidateDetail> {
    return (await request<Data<{ candidate: CandidateDetail }>>(`/candidates/${candidateId}`)).data.candidate;
  },
  async update(candidateId: string, input: { category?: string | null; reason?: string }): Promise<CandidateDetail> {
    return (await request<Data<{ candidate: CandidateDetail }>>(`/candidates/${candidateId}`, json("PATCH", input))).data.candidate;
  },
};

export const progressApi = {
  async jobs(): Promise<JobProgress[]> {
    return (await request<Data<{ jobs: JobProgress[] }>>("/job-requests/progress")).data.jobs;
  },
};
