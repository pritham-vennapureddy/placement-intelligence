import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { sendData } from "../../utils/http.js";
import { testFunction, testObjectStorage, testPostgres, testRealtime } from "./neon.services.js";

const checks = {
  postgres: testPostgres,
  objectStorage: testObjectStorage,
  functions: testFunction,
  realtime: testRealtime,
} as const;

export const neonController = {
  async status(_request: Request, response: Response): Promise<void> {
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
    const healthy = results.every(([, result]) => result.status === "connected");
    sendData(response, { healthy, services: Object.fromEntries(results) }, healthy ? 200 : 503);
  },
};
