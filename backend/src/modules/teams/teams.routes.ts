import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { teamsController } from "./teams.controller.js";
import { createUserSchema, resetPasswordSchema, updateUserSchema, userParamsSchema } from "./teams.validators.js";

export const teamsRouter = Router();

// No router-wide idempotency: replayed responses are stored, and the reset-password
// response carries a plaintext password that must never be persisted.
teamsRouter.use(authenticate);

const manage = requirePermission("user:manage");
const withUser = validateParams(userParamsSchema);

teamsRouter.get("/users", manage, teamsController.listUsers);
teamsRouter.post("/users", manage, idempotency, validateBody(createUserSchema), teamsController.createUser);
teamsRouter.patch("/users/:userId", manage, idempotency, withUser, validateBody(updateUserSchema), teamsController.updateUser);
teamsRouter.post("/users/:userId/reset-password", manage, withUser, validateBody(resetPasswordSchema), teamsController.resetPassword);
teamsRouter.delete("/users/:userId", manage, idempotency, withUser, teamsController.deleteUser);
