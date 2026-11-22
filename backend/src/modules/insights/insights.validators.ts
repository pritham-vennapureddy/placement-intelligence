import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.");

export const CATEGORY_FILTERS = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"] as const;

export const STUDENT_STATUS_FILTERS = [
  "INTERNAL_REJECTED",
  "FINAL_SHORTLIST",
  "NOT_SHARED",
  "SHARED",
  "DIRECT",
  "IN_PROCESS",
  "COMPANY_REJECTED",
  "SELECTED",
  "JOINED",
] as const;
export type StudentStatusFilter = (typeof STUDENT_STATUS_FILTERS)[number];

export const DATE_BASES = ["requested", "processEnd"] as const;

/** One or more HubSpot Job IDs (or parts of them), separated by commas, spaces or new lines. */
const jobIds = z
  .string()
  .max(4000)
  .transform((value) => [...new Set(value.toLowerCase().split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean))])
  .refine((ids) => ids.length <= 200, "Search at most 200 Job IDs at a time.")
  .optional();

/**
 * `from`/`to` are months of the job's request date, or of its company process end
 * date when `dateBy` is "processEnd" (then only jobs with an end date count).
 */
const baseFilters = {
  from: month.optional(),
  to: month.optional(),
  dateBy: z.enum(DATE_BASES).default("requested"),
  category: z.enum(CATEGORY_FILTERS).optional(),
  companyId: z.uuid().optional(),
  jobIds,
};

export const insightsQuerySchema = z
  .object(baseFilters)
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export const studentInsightsQuerySchema = z
  .object({
    ...baseFilters,
    status: z.enum(STUDENT_STATUS_FILTERS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
/** The job-level filters every Insights view shares. */
export type JobScope = Pick<InsightsQuery, "from" | "to" | "dateBy" | "companyId" | "jobIds">;
export type StudentInsightsQuery = z.infer<typeof studentInsightsQuerySchema>;

/** Academy dashboard: which students the funnel, stack, CTC and company tables count. */
export const ACADEMY_CATEGORIES = ["ACADEMY", "ACADEMY_INTENSIVE", "ALL_ACADEMY"] as const;
export const ACADEMY_SEGMENTS = ["ALL", "ASSESSED_POOL", "NOT_IN_POOL", "BUCKET_A", "BUCKET_B", "BUCKET_C"] as const;
export type AcademySegment = (typeof ACADEMY_SEGMENTS)[number];
export const ACADEMY_CANDIDATE_VIEWS = ["ALL", "APPLIED", "POOL", "POOL_APPLIED", "POOL_ZERO_APPLICATIONS", "POOL_ZERO_OPPORTUNITY", "ZERO_APPLICATIONS"] as const;
export type AcademyCandidateView = (typeof ACADEMY_CANDIDATE_VIEWS)[number];

const academyFilters = {
  from: month.optional(),
  to: month.optional(),
  dateBy: z.enum(DATE_BASES).default("requested"),
  companyId: z.uuid().optional(),
  jobIds,
  academyCategory: z.enum(ACADEMY_CATEGORIES).default("ACADEMY"),
  segment: z.enum(ACADEMY_SEGMENTS).default("ALL"),
};

export const academyQuerySchema = z
  .object(academyFilters)
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export const academyCandidatesQuerySchema = z
  .object({
    ...academyFilters,
    view: z.enum(ACADEMY_CANDIDATE_VIEWS).default("ALL"),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

/** One student's applications in the period, for the expandable row. */
export const academyStudentApplicationsQuerySchema = z
  .object({ ...academyFilters })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });
export const academyStudentParamsSchema = z.object({ candidateId: z.uuid() });

export type AcademyQuery = z.infer<typeof academyQuerySchema>;
export type AcademyCandidatesQuery = z.infer<typeof academyCandidatesQuerySchema>;
