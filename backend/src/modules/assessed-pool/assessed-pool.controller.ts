import type { Request, Response } from "express";
import { sendCreated, sendData, sendNoContent } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { assessedPoolService } from "./assessed-pool.service.js";
import { assessedPoolSourceService } from "./assessed-pool.source.js";
import type { AssessedPoolLookupQuery, ImportQuery, PreviewQuery, SourceConnectBody, SourcePreviewBody } from "./assessed-pool.validators.js";
import { ApiError } from "../../utils/api-error.js";

function fileBytes(request: Request): Buffer {
  if (!Buffer.isBuffer(request.body)) {
    throw new ApiError(400, "FILE_REQUIRED", "Choose an .xlsx or .csv file to upload.");
  }
  return request.body;
}

export const assessedPoolController = {
  async preview(request: Request, response: Response): Promise<void> {
    const query = request.query as unknown as PreviewQuery;
    sendData(response, await assessedPoolService.preview(fileBytes(request), query));
  },

  async importFile(request: Request, response: Response): Promise<void> {
    const query = request.query as unknown as ImportQuery;
    sendCreated(response, await assessedPoolService.importFile(fileBytes(request), query, request.user!, auditContextFrom(request)));
  },

  async analytics(_request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolService.analytics());
  },

  async lookup(request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolService.lookup(request.user!, request.query as unknown as AssessedPoolLookupQuery));
  },

  async getSource(_request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolSourceService.getSource());
  },

  async previewSource(request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolSourceService.preview(request.body as SourcePreviewBody));
  },

  async connectSource(request: Request, response: Response): Promise<void> {
    sendCreated(response, await assessedPoolSourceService.connect(request.body as SourceConnectBody, request.user!, auditContextFrom(request)));
  },

  async syncSource(request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolSourceService.sync(request.user!, auditContextFrom(request)));
  },

  async disconnectSource(request: Request, response: Response): Promise<void> {
    await assessedPoolSourceService.disconnect(auditContextFrom(request));
    sendNoContent(response);
  },

  async deleteImport(request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolService.deleteImport(String(request.params.importId), auditContextFrom(request)));
  },

  async clearAll(request: Request, response: Response): Promise<void> {
    sendData(response, await assessedPoolService.clearAll(auditContextFrom(request)));
  },
};
