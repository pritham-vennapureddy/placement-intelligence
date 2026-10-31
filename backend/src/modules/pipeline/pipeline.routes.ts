import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { pipelineController } from "./pipeline.controller.js";
import {
  createRoundSchema,
  interviewParamsSchema,
  interviewSchema,
  jobParamsSchema,
  nominateSchema,
  nominationParamsSchema,
  pipelineStatusSchema,
  reorderRoundsSchema,
  roundParamsSchema,
  updateRoundSchema,
  withdrawSchema,
} from "./pipeline.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/pipeline. */
export const pipelineRouter = Router({ mergeParams: true });
pipelineRouter.use(authenticate, idempotency, requirePermission("job:read"));

const write = requirePermission("pipeline:write");

pipelineRouter.get("/", validateParams(jobParamsSchema), pipelineController.get);
pipelineRouter.get("/eligible", validateParams(jobParamsSchema), pipelineController.eligible);
pipelineRouter.post("/rounds", write, validateParams(jobParamsSchema), validateBody(createRoundSchema), pipelineController.createRound);
pipelineRouter.put("/rounds/order", write, validateParams(jobParamsSchema), validateBody(reorderRoundsSchema), pipelineController.reorderRounds);
pipelineRouter.patch("/rounds/:roundId", write, validateParams(roundParamsSchema), validateBody(updateRoundSchema), pipelineController.updateRound);
pipelineRouter.delete("/rounds/:roundId", write, validateParams(roundParamsSchema), pipelineController.deleteRound);
pipelineRouter.post("/nominations", write, validateParams(jobParamsSchema), validateBody(nominateSchema), pipelineController.nominate);
pipelineRouter.post("/nominations/:nominationId/status", write, validateParams(nominationParamsSchema), validateBody(pipelineStatusSchema), pipelineController.changeStatus);
pipelineRouter.post("/nominations/:nominationId/withdraw", write, validateParams(nominationParamsSchema), validateBody(withdrawSchema), pipelineController.withdraw);
pipelineRouter.put(
  "/nominations/:nominationId/interviews/:roundId",
  write,
  validateParams(interviewParamsSchema),
  validateBody(interviewSchema),
  pipelineController.recordInterview,
);
