import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { importsController } from "./imports.controller.js";
import {
  approveSchema,
  batchIdParamsSchema,
  googleImportSchema,
  googleRefreshSchema,
  previewQuerySchema,
  rowParamsSchema,
  rowsQuerySchema,
  updateRowSchema,
  valuesQuerySchema,
} from "./imports.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/imports. */
export const jobImportsRouter = Router({ mergeParams: true });
jobImportsRouter.use(authenticate, validateParams(z.object({ jobRequestId: z.uuid() })));
jobImportsRouter.get("/", requirePermission("job:read"), importsController.listForJob);
// Google Sheets links are read-only; internal shortlisting sheets are saved directly after mapping.
jobImportsRouter.post("/google", idempotency, requirePermission("import:run"), validateBody(googleImportSchema), importsController.importFromGoogle);
jobImportsRouter.post("/google/refresh", idempotency, requirePermission("import:run"), validateBody(googleRefreshSchema), importsController.refreshFromGoogle);

/** Mounted under /api/imports. */
export const importsRouter = Router();
importsRouter.use(authenticate, idempotency, requirePermission("job:read"));
importsRouter.get("/", importsController.list);
importsRouter.get("/google-info", importsController.googleInfo);
importsRouter.get("/templates/internal-standard.xlsx", importsController.internalTemplate);
importsRouter.get("/:batchId", validateParams(batchIdParamsSchema), importsController.get);
importsRouter.get("/:batchId/preview", validateParams(batchIdParamsSchema), validateQuery(previewQuerySchema), importsController.preview);
importsRouter.get("/:batchId/values", validateParams(batchIdParamsSchema), validateQuery(valuesQuerySchema), importsController.values);
importsRouter.get("/:batchId/rows", validateParams(batchIdParamsSchema), validateQuery(rowsQuerySchema), importsController.rows);
// The mapping body is validated in the service: its shape depends on the import's target.
importsRouter.post("/:batchId/validate", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.validate);
importsRouter.post("/:batchId/save", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.save);
importsRouter.patch("/:batchId/rows/:rowId", requirePermission("import:run"), validateParams(rowParamsSchema), validateBody(updateRowSchema), importsController.updateRow);
importsRouter.post("/:batchId/approve", requirePermission("import:run"), validateParams(batchIdParamsSchema), validateBody(approveSchema), importsController.approve);
importsRouter.post("/:batchId/cancel", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.cancel);
importsRouter.delete("/:batchId", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.delete);
