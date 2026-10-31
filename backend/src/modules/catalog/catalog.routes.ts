import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { catalogController } from "./catalog.controller.js";

export const catalogRouter = Router();

catalogRouter.use(authenticate, requirePermission("dashboard:read"));

catalogRouter.get("/products", catalogController.products);
catalogRouter.get("/skills", catalogController.skills);
