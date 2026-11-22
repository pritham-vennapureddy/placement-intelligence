import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { validateParams, validateQuery } from "../../middleware/validate.js";
import { sendData } from "../../utils/http.js";
import { academyInsightsService } from "./academy-insights.service.js";
import { insightsService } from "./insights.service.js";
import {
  academyCandidatesQuerySchema,
  academyQuerySchema,
  academyStudentApplicationsQuerySchema,
  academyStudentParamsSchema,
  insightsQuerySchema,
  studentInsightsQuerySchema,
  type AcademyCandidatesQuery,
  type AcademyQuery,
  type InsightsQuery,
  type StudentInsightsQuery,
} from "./insights.validators.js";

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

/** Academy & assessed-pool review: funnel, segments, stack, CTC, pool coverage and RSA. */
insightsRouter.get("/academy", validateQuery(academyQuerySchema), async (request: Request, response: Response) => {
  sendData(response, await academyInsightsService.overview(request.user!, request.query as unknown as AcademyQuery));
});

insightsRouter.get(
  "/academy/candidates/:candidateId/applications",
  requirePermission("candidate:read"),
  validateParams(academyStudentParamsSchema),
  validateQuery(academyStudentApplicationsQuerySchema),
  async (request: Request, response: Response) => {
    sendData(response, { items: await academyInsightsService.studentApplications(request.user!, request.params.candidateId as string, request.query as unknown as AcademyQuery) });
  },
);

insightsRouter.get("/academy/candidates", requirePermission("candidate:read"), validateQuery(academyCandidatesQuerySchema), async (request: Request, response: Response) => {
  sendData(response, { items: await academyInsightsService.candidates(request.user!, request.query as unknown as AcademyCandidatesQuery) });
});
