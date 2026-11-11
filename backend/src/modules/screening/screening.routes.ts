import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateParams, validateQuery } from "../../middleware/validate.js";
import { screeningController } from "./screening.controller.js";
import {
  jobParamsSchema,
  stageCandidatesQuerySchema,
  stageParamsSchema,
} from "./screening.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/screening. */
export const screeningRouter = Router({ mergeParams: true });
screeningRouter.use(authenticate, idempotency, requirePermission("job:read"));

screeningRouter.get("/", validateParams(jobParamsSchema), screeningController.get);
screeningRouter.get(
  "/stages/:stage/candidates",
  validateParams(stageParamsSchema),
  validateQuery(stageCandidatesQuerySchema),
  screeningController.listCandidates,
);
