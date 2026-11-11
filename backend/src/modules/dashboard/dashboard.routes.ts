import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { validateParams, validateQuery } from "../../middleware/validate.js";
import { dashboardController } from "./dashboard.controller.js";
import { candidateAnalyticsQuerySchema, placementKpisQuerySchema, summaryQuerySchema } from "./dashboard.validators.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  authenticate,
  requirePermission("dashboard:read"),
  validateQuery(summaryQuerySchema),
  dashboardController.summary,
);
dashboardRouter.get(
  "/placement-kpis",
  authenticate,
  requirePermission("dashboard:read"),
  validateQuery(placementKpisQuerySchema),
  dashboardController.placementKpis,
);
dashboardRouter.get(
  "/companies/:companyId/analytics",
  authenticate,
  requirePermission("dashboard:read"),
  validateParams(z.object({ companyId: z.uuid() })),
  dashboardController.companyAnalytics,
);
dashboardRouter.get(
  "/companies/:companyId/jobs/:jobId/candidates",
  authenticate,
  requirePermission("dashboard:read"),
  requirePermission("candidate:read"),
  validateParams(z.object({ companyId: z.uuid(), jobId: z.uuid() })),
  validateQuery(candidateAnalyticsQuerySchema),
  dashboardController.jobCandidates,
);
