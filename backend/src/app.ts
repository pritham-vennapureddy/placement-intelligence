import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { REQUEST_ID_HEADER } from "@placement/shared";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { sendData } from "./utils/http.js";
import { applicationsRouter } from "./modules/applications/applications.routes.js";
import { assessedPoolRouter } from "./modules/assessed-pool/assessed-pool.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { candidatesRouter } from "./modules/candidates/candidates.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import { companiesRouter } from "./modules/companies/companies.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { importsRouter, jobImportsRouter } from "./modules/imports/imports.routes.js";
import { insightsRouter } from "./modules/insights/insights.routes.js";
import { jobRequestsRouter } from "./modules/job-requests/job-requests.routes.js";
import { neonRouter } from "./modules/neon/neon.routes.js";
import { pipelineRouter } from "./modules/pipeline/pipeline.routes.js";
import { screeningRouter } from "./modules/screening/screening.routes.js";
import { teamsRouter } from "./modules/teams/teams.routes.js";
import { guidanceRouter, jobTrackingRouter, myWorkRouter } from "./modules/tracking/tracking.routes.js";
import { sheetsRouter } from "./modules/sheets/sheets.routes.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.NODE_ENV === "production" ? 1 : false);
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
  exposedHeaders: [REQUEST_ID_HEADER, "Idempotent-Replayed"],
}));
app.use(pinoHttp({
  logger,
  // Accept a well-formed upstream request ID, otherwise mint one; echo it back.
  genReqId: (request, response) => {
    const incoming = request.headers[REQUEST_ID_HEADER.toLowerCase()];
    const id = typeof incoming === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));

app.get("/api/health", (_request, response) => {
  sendData(response, { status: "ok" });
});
app.use("/api/auth", authRouter);
app.use("/api/assessed-pool", assessedPoolRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/job-requests/:jobRequestId/imports", jobImportsRouter);
app.use("/api/job-requests/:jobRequestId/applications", applicationsRouter);
app.use("/api/job-requests/:jobRequestId/screening", screeningRouter);
app.use("/api/job-requests/:jobRequestId/pipeline", pipelineRouter);
app.use("/api/job-requests/:jobRequestId/tracking", jobTrackingRouter);
app.use("/api/job-requests", jobRequestsRouter);
app.use("/api/imports", importsRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/guidance", guidanceRouter);
app.use("/api/my-work", myWorkRouter);
app.use("/api/integrations/neon", neonRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/sheets", sheetsRouter);

app.use((_request, response) => {
  response.status(404).json({
    error: { code: "NOT_FOUND", message: "The requested resource was not found." },
  });
});
app.use(errorHandler);
