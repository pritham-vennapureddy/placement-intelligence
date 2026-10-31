import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { importsService } from "./imports.service.js";
import type { PreviewQuery, RowsQuery, UpdateRowInput, ValuesQuery } from "./imports.validators.js";

const batchIdOf = (request: Request) => request.params.batchId as string;

export const importsController = {
  async upload(request: Request, response: Response): Promise<void> {
    const target = request.query.target as "INTERNAL_SCREENING" | "COMPANY_PIPELINE";
    const result = await importsService.upload(request.user!, request.params.jobRequestId as string, target, request.file, auditContextFrom(request));
    sendCreated(response, result);
  },

  async listForJob(request: Request, response: Response): Promise<void> {
    sendData(response, { batches: await importsService.listForJob(request.user!, request.params.jobRequestId as string) });
  },

  async list(request: Request, response: Response): Promise<void> {
    const { batches, meta } = await importsService.list(request.user!, paginationQuerySchema.parse(request.query));
    sendData(response, { batches }, 200, meta);
  },

  async get(request: Request, response: Response): Promise<void> {
    sendData(response, { batch: await importsService.get(request.user!, batchIdOf(request)) });
  },

  async preview(request: Request, response: Response): Promise<void> {
    sendData(response, await importsService.preview(request.user!, batchIdOf(request), request.query as unknown as PreviewQuery));
  },

  async values(request: Request, response: Response): Promise<void> {
    sendData(response, await importsService.values(request.user!, batchIdOf(request), request.query as unknown as ValuesQuery));
  },

  async validate(request: Request, response: Response): Promise<void> {
    sendData(response, { batch: await importsService.validate(request.user!, batchIdOf(request), request.body, auditContextFrom(request)) });
  },

  async rows(request: Request, response: Response): Promise<void> {
    const { rows, meta } = await importsService.rows(request.user!, batchIdOf(request), request.query as unknown as RowsQuery);
    sendData(response, { rows }, 200, meta);
  },

  async updateRow(request: Request, response: Response): Promise<void> {
    const batch = await importsService.updateRow(
      request.user!,
      batchIdOf(request),
      request.params.rowId as string,
      request.body as UpdateRowInput,
      auditContextFrom(request),
    );
    sendData(response, { batch });
  },

  async approve(request: Request, response: Response): Promise<void> {
    const notes = (request.body as { notes?: string }).notes;
    sendData(response, await importsService.approve(request.user!, batchIdOf(request), notes, auditContextFrom(request)));
  },

  async cancel(request: Request, response: Response): Promise<void> {
    sendData(response, { batch: await importsService.cancel(request.user!, batchIdOf(request), auditContextFrom(request)) });
  },
};
