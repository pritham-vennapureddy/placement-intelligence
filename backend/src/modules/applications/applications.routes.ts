import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { applicationsController } from "./applications.controller.js";
import { addApplicationSchema, carryOverCandidatesQuerySchema, carryOverSchema } from "./applications.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/applications. */
export const applicationsRouter = Router({ mergeParams: true });
applicationsRouter.use(authenticate, idempotency, requirePermission("job:read"), validateParams(z.object({ jobRequestId: z.uuid() })));
applicationsRouter.post("/", requirePermission("candidate:write"), validateBody(addApplicationSchema), applicationsController.add);
applicationsRouter.get("/carry-over/sources", applicationsController.sources);
applicationsRouter.get("/carry-over/candidates", validateQuery(carryOverCandidatesQuerySchema), applicationsController.candidates);
applicationsRouter.post("/carry-over", requirePermission("candidate:write"), validateBody(carryOverSchema), applicationsController.carryOver);
