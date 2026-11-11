import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const listCandidatesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  productId: z.uuid().optional(),
  category: z.enum(["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"]).optional(),
  poolType: z.enum(["BUCKET", "TR", "COMPETENCY"]).optional(),
  poolOnly: z.coerce.boolean().optional(),
  jobRequestId: z.uuid().optional(),
});

export const updateCandidateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().max(254).nullable().optional(),
    mobile: z.string().trim().max(20).nullable().optional(),
    college: z.string().trim().max(200).nullable().optional(),
    degree: z.string().trim().max(160).nullable().optional(),
    graduationYear: z.number().int().min(1980).max(2100).nullable().optional(),
    resumeUrl: z.url().max(1000).nullable().optional(),
    category: z.enum(["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"]).nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.entries(value).some(([key, entry]) => key !== "reason" && entry !== undefined), { message: "Nothing to change." });

export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;
