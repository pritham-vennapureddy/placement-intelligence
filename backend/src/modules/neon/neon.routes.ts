import { Router } from "express";
import { logger } from "../../config/logger.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorize } from "../../middleware/authorize.js";
import {
  testFunction,
  testObjectStorage,
  testPostgres,
  testRealtime,
} from "./neon.services.js";

export const neonRouter = Router();

const checks = {
  postgres: testPostgres,
  objectStorage: testObjectStorage,
  functions: testFunction,
  realtime: testRealtime,
} as const;

neonRouter.get("/status", authenticate, authorize("ADMIN"), async (_request, response) => {
  const results = await Promise.all(
    Object.entries(checks).map(async ([service, check]) => {
      try {
        await check();
        return [service, { status: "connected" }] as const;
      } catch (error) {
        logger.error(
          { service, errorMessage: error instanceof Error ? error.message : "Unknown error" },
          "Neon service connectivity check failed",
        );
        return [service, { status: "error", message: "Connectivity check failed." }] as const;
      }
    }),
  );
  const services = Object.fromEntries(results);
  const healthy = results.every(([, result]) => result.status === "connected");

  response.status(healthy ? 200 : 503).json({ data: { healthy, services } });
});
