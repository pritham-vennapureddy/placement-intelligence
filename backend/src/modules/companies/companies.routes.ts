import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { companiesController } from "./companies.controller.js";
import {
  companyIdParamsSchema,
  createCompanySchema,
  companyOptionsQuerySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from "./companies.validators.js";

export const companiesRouter = Router();

companiesRouter.use(authenticate, idempotency, requirePermission("company:read"));

companiesRouter.get("/", validateQuery(listCompaniesQuerySchema), companiesController.list);
companiesRouter.get("/options", validateQuery(companyOptionsQuerySchema), companiesController.options);
companiesRouter.post("/", requirePermission("company:write"), validateBody(createCompanySchema), companiesController.create);
companiesRouter.get("/:companyId", validateParams(companyIdParamsSchema), companiesController.get);
companiesRouter.patch(
  "/:companyId",
  requirePermission("company:write"),
  validateParams(companyIdParamsSchema),
  validateBody(updateCompanySchema),
  companiesController.update,
);
companiesRouter.delete(
  "/:companyId",
  requirePermission("job:assign"),
  validateParams(companyIdParamsSchema),
  companiesController.delete,
);
