import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { sheetsController } from "./sheets.controller.js";
import {
  connectionParamsSchema,
  createConnectionSchema,
  createMappingSchema,
  headerParamsSchema,
  headerQuerySchema,
} from "./sheets.validators.js";

export const sheetsRouter = Router();

sheetsRouter.use(authenticate, idempotency, requirePermission("sheet:read"));

sheetsRouter.get("/", sheetsController.setup);
sheetsRouter.post(
  "/",
  requirePermission("sheet:manage"),
  validateBody(createConnectionSchema),
  sheetsController.connect,
);
sheetsRouter.get("/:connectionId/tabs", validateParams(connectionParamsSchema), sheetsController.tabs);
sheetsRouter.get(
  "/:connectionId/tabs/:sheetId/headers",
  validateParams(headerParamsSchema),
  validateQuery(headerQuerySchema),
  sheetsController.headers,
);
sheetsRouter.post(
  "/:connectionId/mappings",
  requirePermission("sheet:manage"),
  validateParams(connectionParamsSchema),
  validateBody(createMappingSchema),
  sheetsController.saveMapping,
);
