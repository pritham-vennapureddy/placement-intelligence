import type { Request, Response } from "express";
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
};
