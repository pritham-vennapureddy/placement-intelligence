import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { validateQuery } from "../../middleware/validate.js";
import { dashboardController } from "./dashboard.controller.js";
import { summaryQuerySchema } from "./dashboard.validators.js";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  authenticate,
  requirePermission("dashboard:read"),
  validateQuery(summaryQuerySchema),
  dashboardController.summary,
);
