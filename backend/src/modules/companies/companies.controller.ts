import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { companiesService } from "./companies.service.js";
import type { CompanyOptionsQuery, CreateCompanyInput, ListCompaniesQuery, UpdateCompanyInput } from "./companies.validators.js";

export const companiesController = {
  async options(request: Request, response: Response): Promise<void> {
    sendData(response, { companies: await companiesService.options(request.user!, request.query as unknown as CompanyOptionsQuery) });
  },

  async list(request: Request, response: Response): Promise<void> {
    const { companies, meta } = await companiesService.list(request.user!, request.query as unknown as ListCompaniesQuery);
    sendData(response, { companies }, 200, meta);
  },

  async get(request: Request, response: Response): Promise<void> {
    sendData(response, { company: await companiesService.get(request.user!, request.params.companyId as string) });
  },

  async create(request: Request, response: Response): Promise<void> {
    const company = await companiesService.create(request.user!, request.body as CreateCompanyInput, auditContextFrom(request));
    sendCreated(response, { company });
  },

  async update(request: Request, response: Response): Promise<void> {
    const company = await companiesService.update(
      request.user!,
      request.params.companyId as string,
      request.body as UpdateCompanyInput,
      auditContextFrom(request),
    );
    sendData(response, { company });
  },

  async delete(request: Request, response: Response): Promise<void> {
    sendData(response, {
      company: await companiesService.delete(
        request.user!,
        request.params.companyId as string,
        auditContextFrom(request),
      ),
    });
  },
};
