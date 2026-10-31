import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { teamsController } from "./teams.controller.js";
import {
  createTeamSchema,
  createUserSchema,
  teamIdParamsSchema,
  teamMembersSchema,
} from "./teams.validators.js";

export const teamsRouter = Router();

teamsRouter.use(authenticate, idempotency);

teamsRouter.get("/", teamsController.list);
teamsRouter.get("/users", requirePermission("user:manage"), teamsController.listUsers);
teamsRouter.post("/", requirePermission("team:manage"), validateBody(createTeamSchema), teamsController.create);
teamsRouter.post("/users", requirePermission("user:manage"), validateBody(createUserSchema), teamsController.createUser);
teamsRouter.put(
  "/:teamId/members",
  requirePermission("team:manage"),
  validateParams(teamIdParamsSchema),
  validateBody(teamMembersSchema),
  teamsController.updateMembers,
);
