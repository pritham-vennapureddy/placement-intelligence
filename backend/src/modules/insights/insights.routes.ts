import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { validateQuery } from "../../middleware/validate.js";
import { sendData } from "../../utils/http.js";
import { insightsService } from "./insights.service.js";
import { insightsQuerySchema, studentInsightsQuerySchema, type InsightsQuery, type StudentInsightsQuery } from "./insights.validators.js";

/** Mounted under /api/insights: stakeholder metrics (company, month and student level). */
export const insightsRouter = Router();
insightsRouter.use(authenticate, requirePermission("report:read"));

insightsRouter.get("/", validateQuery(insightsQuerySchema), async (request: Request, response: Response) => {
  sendData(response, await insightsService.overview(request.user!, request.query as unknown as InsightsQuery));
});

insightsRouter.get("/students", requirePermission("candidate:read"), validateQuery(studentInsightsQuerySchema), async (request: Request, response: Response) => {
  const { items, meta } = await insightsService.students(request.user!, request.query as unknown as StudentInsightsQuery);
  sendData(response, { items }, 200, meta);
});
