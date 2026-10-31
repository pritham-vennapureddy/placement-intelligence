import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { screeningController } from "./screening.controller.js";
import {
  addToStageSchema,
  decisionSchema,
  jobParamsSchema,
  stageCandidateParamsSchema,
  stageCandidatesQuerySchema,
  stageParamsSchema,
  updateProcessSchema,
  updateStageSchema,
} from "./screening.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/screening. */
export const screeningRouter = Router({ mergeParams: true });
screeningRouter.use(authenticate, idempotency, requirePermission("job:read"));

const write = requirePermission("screening:write");

screeningRouter.get("/", validateParams(jobParamsSchema), screeningController.get);
screeningRouter.patch("/", write, validateParams(jobParamsSchema), validateBody(updateProcessSchema), screeningController.updateNotes);
screeningRouter.patch("/stages/:stage", write, validateParams(stageParamsSchema), validateBody(updateStageSchema), screeningController.updateStage);
screeningRouter.get(
  "/stages/:stage/candidates",
  validateParams(stageParamsSchema),
  validateQuery(stageCandidatesQuerySchema),
  screeningController.listCandidates,
);
screeningRouter.post("/stages/:stage/candidates", write, validateParams(stageParamsSchema), validateBody(addToStageSchema), screeningController.addToStage);
screeningRouter.put(
  "/stages/:stage/candidates/:applicationId",
  write,
  validateParams(stageCandidateParamsSchema),
  validateBody(decisionSchema),
  screeningController.decide,
);
