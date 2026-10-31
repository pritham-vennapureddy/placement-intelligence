import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { neonController } from "./neon.controller.js";

export const neonRouter = Router();

neonRouter.get("/status", authenticate, requirePermission("integration:admin"), neonController.status);
