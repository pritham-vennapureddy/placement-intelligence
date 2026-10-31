import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { importsController } from "./imports.controller.js";
import {
  approveSchema,
  batchIdParamsSchema,
  previewQuerySchema,
  rowParamsSchema,
  rowsQuerySchema,
  updateRowSchema,
  uploadQuerySchema,
  valuesQuerySchema,
} from "./imports.validators.js";

// Files stay in memory: they are parsed and stored with the batch, never written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

/** Mounted under /api/job-requests/:jobRequestId/imports. */
export const jobImportsRouter = Router({ mergeParams: true });
jobImportsRouter.use(authenticate, validateParams(z.object({ jobRequestId: z.uuid() })));
jobImportsRouter.get("/", requirePermission("job:read"), importsController.listForJob);
jobImportsRouter.post("/", requirePermission("import:run"), validateQuery(uploadQuerySchema), upload.single("file"), importsController.upload);

/** Mounted under /api/imports. */
export const importsRouter = Router();
importsRouter.use(authenticate, idempotency, requirePermission("job:read"));
importsRouter.get("/", importsController.list);
importsRouter.get("/:batchId", validateParams(batchIdParamsSchema), importsController.get);
importsRouter.get("/:batchId/preview", validateParams(batchIdParamsSchema), validateQuery(previewQuerySchema), importsController.preview);
importsRouter.get("/:batchId/values", validateParams(batchIdParamsSchema), validateQuery(valuesQuerySchema), importsController.values);
importsRouter.get("/:batchId/rows", validateParams(batchIdParamsSchema), validateQuery(rowsQuerySchema), importsController.rows);
// The mapping body is validated in the service: its shape depends on the import's target.
importsRouter.post("/:batchId/validate", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.validate);
importsRouter.patch("/:batchId/rows/:rowId", requirePermission("import:run"), validateParams(rowParamsSchema), validateBody(updateRowSchema), importsController.updateRow);
importsRouter.post("/:batchId/approve", requirePermission("import:run"), validateParams(batchIdParamsSchema), validateBody(approveSchema), importsController.approve);
importsRouter.post("/:batchId/cancel", requirePermission("import:run"), validateParams(batchIdParamsSchema), importsController.cancel);
