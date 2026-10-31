import type { Request, Response } from "express";
import { resolveDataScope } from "../../services/data-scope.service.js";
import { sendData } from "../../utils/http.js";
import { catalogRepository } from "./catalog.repository.js";

// Read-only reference lists with no business rules, so the controller reads the repository directly.
export const catalogController = {
  async products(_request: Request, response: Response): Promise<void> {
    sendData(response, { products: await catalogRepository.listActiveProducts() });
  },

  async skills(_request: Request, response: Response): Promise<void> {
    sendData(response, { skills: await catalogRepository.listSkills() });
  },

  /** PSMs the user may pick as a job owner: everyone (admin), their team (manager), themselves (PSM). */
  async owners(request: Request, response: Response): Promise<void> {
    const scope = await resolveDataScope(request.user!);
    const owners = await catalogRepository.listActivePsms(scope.kind === "organization" ? undefined : scope.ownerIds);
    sendData(response, { owners });
  },
};
