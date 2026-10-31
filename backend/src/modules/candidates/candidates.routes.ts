import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { candidatesController } from "./candidates.controller.js";
import { listCandidatesQuerySchema, updateCandidateSchema } from "./candidates.validators.js";

const idParams = validateParams(z.object({ candidateId: z.uuid() }));

export const candidatesRouter = Router();
candidatesRouter.use(authenticate, idempotency, requirePermission("candidate:read"));
candidatesRouter.get("/", validateQuery(listCandidatesQuerySchema), candidatesController.list);
candidatesRouter.get("/:candidateId", idParams, candidatesController.get);
candidatesRouter.patch("/:candidateId", requirePermission("candidate:write"), idParams, validateBody(updateCandidateSchema), candidatesController.update);
