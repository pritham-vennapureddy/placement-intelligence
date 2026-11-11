import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.");

export const CATEGORY_FILTERS = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"] as const;

export const STUDENT_STATUS_FILTERS = [
  "INTERNAL_REJECTED",
  "FINAL_SHORTLIST",
  "NOT_SHARED",
  "SHARED",
  "IN_PROCESS",
  "COMPANY_REJECTED",
  "SELECTED",
  "JOINED",
] as const;
export type StudentStatusFilter = (typeof STUDENT_STATUS_FILTERS)[number];

/** Filters on the job's request month (a drive belongs to the month it was requested). */
export const insightsQuerySchema = z
  .object({
    from: month.optional(),
    to: month.optional(),
    category: z.enum(CATEGORY_FILTERS).optional(),
    companyId: z.uuid().optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export const studentInsightsQuerySchema = z
  .object({
    from: month.optional(),
    to: month.optional(),
    category: z.enum(CATEGORY_FILTERS).optional(),
    companyId: z.uuid().optional(),
    status: z.enum(STUDENT_STATUS_FILTERS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
export type StudentInsightsQuery = z.infer<typeof studentInsightsQuerySchema>;
