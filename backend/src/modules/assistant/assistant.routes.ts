import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate.js";
import { sendData } from "../../utils/http.js";
import { assistantService } from "./assistant.service.js";
import { chatSchema, type ChatInput } from "./assistant.validators.js";

/** Mounted under /api/assistant: "Ask the data" chat over the dashboard's read-only data. */
export const assistantRouter = Router();

assistantRouter.post(
  "/chat",
  authenticate,
  requirePermission("report:read"),
  // Each question can mean several AI calls; keep one person from using up the free quota.
  rateLimit({ windowMs: 60_000, limit: 12, keyGenerator: (request) => request.user?.id ?? ipKeyGenerator(request.ip ?? ""), standardHeaders: true, legacyHeaders: false }),
  validateBody(chatSchema),
  async (request: Request, response: Response) => {
    sendData(response, await assistantService.chat(request.user!, request.body as ChatInput));
  },
);
