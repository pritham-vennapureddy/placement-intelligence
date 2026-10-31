import type { Request, Response } from "express";
import { sendData } from "../../utils/http.js";
import { dashboardService } from "./dashboard.service.js";
import type { SummaryQuery } from "./dashboard.validators.js";

export const dashboardController = {
  async summary(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getSummary(request.user!, request.query as SummaryQuery));
  },
};
