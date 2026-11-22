import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { rejectionTagsService } from "./rejection-tags.service.js";

export const tagLabelSchema = z.object({ label: z.string().trim().min(2, "Type the reason.").max(80, "Keep the reason under 80 characters.") });
const tagParamsSchema = z.object({ tagId: z.uuid() });

/** Mounted under /api/rejection-reasons: the company-round rejection reason list. */
export const rejectionTagsRouter = Router();
rejectionTagsRouter.use(authenticate, idempotency);
rejectionTagsRouter.get("/", requirePermission("job:read"), async (_request: Request, response: Response) => {
  sendData(response, { reasons: await rejectionTagsService.list() });
});
rejectionTagsRouter.post("/", requirePermission("pipeline:write"), validateBody(tagLabelSchema), async (request: Request, response: Response) => {
  sendCreated(response, { reason: await rejectionTagsService.create(request.user!, (request.body as { label: string }).label, auditContextFrom(request)) });
});
rejectionTagsRouter.patch("/:tagId", requirePermission("pipeline:write"), validateParams(tagParamsSchema), validateBody(tagLabelSchema), async (request: Request, response: Response) => {
  sendData(response, { reason: await rejectionTagsService.rename(request.user!, request.params.tagId as string, (request.body as { label: string }).label, auditContextFrom(request)) });
});
rejectionTagsRouter.delete("/:tagId", requirePermission("pipeline:write"), validateParams(tagParamsSchema), async (request: Request, response: Response) => {
  sendData(response, await rejectionTagsService.remove(request.user!, request.params.tagId as string, auditContextFrom(request)));
});
