import express, { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { assessedPoolController } from "./assessed-pool.controller.js";
import {
  importParamsSchema,
  importQuerySchema,
  assessedPoolLookupQuerySchema,
  previewQuerySchema,
  sourceConnectBodySchema,
  sourcePreviewBodySchema,
} from "./assessed-pool.validators.js";

export const assessedPoolRouter = Router();
const spreadsheetBody = express.raw({
  type: [
    "application/octet-stream",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  limit: "20mb",
});

assessedPoolRouter.use(authenticate);
assessedPoolRouter.get("/analytics", requirePermission("candidate:read"), assessedPoolController.analytics);
assessedPoolRouter.get(
  "/lookup",
  requirePermission("candidate:read"),
  validateQuery(assessedPoolLookupQuerySchema),
  assessedPoolController.lookup,
);
assessedPoolRouter.post(
  "/preview",
  requirePermission("import:run"),
  spreadsheetBody,
  validateQuery(previewQuerySchema),
  assessedPoolController.preview,
);
assessedPoolRouter.post(
  "/imports",
  requirePermission("import:run"),
  spreadsheetBody,
  idempotency,
  validateQuery(importQuerySchema),
  assessedPoolController.importFile,
);

assessedPoolRouter.get("/source", requirePermission("candidate:read"), assessedPoolController.getSource);
assessedPoolRouter.post(
  "/source/preview",
  requirePermission("import:run"),
  validateBody(sourcePreviewBodySchema),
  assessedPoolController.previewSource,
);
assessedPoolRouter.put(
  "/source",
  requirePermission("import:run"),
  idempotency,
  validateBody(sourceConnectBodySchema),
  assessedPoolController.connectSource,
);
assessedPoolRouter.post("/source/sync", requirePermission("import:run"), idempotency, assessedPoolController.syncSource);
assessedPoolRouter.delete("/source", requirePermission("import:run"), assessedPoolController.disconnectSource);
assessedPoolRouter.delete(
  "/imports/:importId",
  requirePermission("import:run"),
  validateParams(importParamsSchema),
  assessedPoolController.deleteImport,
);
assessedPoolRouter.delete("/records", requirePermission("import:run"), assessedPoolController.clearAll);
