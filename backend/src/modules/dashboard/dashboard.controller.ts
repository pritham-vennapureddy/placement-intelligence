import type { Request, Response } from "express";
import { sendData } from "../../utils/http.js";
import { dashboardService } from "./dashboard.service.js";

export const dashboardController = {
  async summary(request: Request, response: Response): Promise<void> {
    sendData(response, await dashboardService.getSummary(request.user!));
  },
};
