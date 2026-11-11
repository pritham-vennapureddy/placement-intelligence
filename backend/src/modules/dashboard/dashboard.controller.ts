import type { Request, Response } from "express";
import { sendData } from "../../utils/http.js";
import { dashboardService } from "./dashboard.service.js";
import type { CandidateAnalyticsQuery, PlacementKpisQuery, SummaryQuery } from "./dashboard.validators.js";

export const dashboardController = {
  async companyAnalytics(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getCompanyAnalytics(request.user!, request.params.companyId as string));
  },

  async jobCandidates(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getJobCandidates(
      request.user!,
      request.params.companyId as string,
      request.params.jobId as string,
      request.query as unknown as CandidateAnalyticsQuery,
    ));
  },

  async placementKpis(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getPlacementKpis(request.user!, request.query as PlacementKpisQuery));
  },

  async summary(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getSummary(request.user!, request.query as SummaryQuery));
  },
};
