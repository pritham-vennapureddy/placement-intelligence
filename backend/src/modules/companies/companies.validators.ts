import { z } from "zod";
import { parseHubspotRecordId } from "@placement/shared";
import { paginationQuerySchema } from "../../utils/pagination.js";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null).nullable().optional();

/** A HubSpot company link or bare ID, normalised to the numeric ID (or null to clear it). */
const hubspotCompany = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const id = parseHubspotRecordId(value, "company");
    if (!id) {
      context.addIssue({ code: "custom", message: "Paste a HubSpot company link (…/record/0-2/…) or its numeric ID." });
      return z.NEVER;
    }
    return id;
  });

export const companyIdParamsSchema = z.object({ companyId: z.uuid() });

export const listCompaniesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const companyOptionsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(160),
  hubspotCompany,
  website: z.url().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  industry: optionalText(120),
  location: optionalText(120),
  notes: optionalText(2000),
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;
export type CompanyOptionsQuery = z.infer<typeof companyOptionsQuerySchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
