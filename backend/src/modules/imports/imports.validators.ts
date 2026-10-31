import { z } from "zod";
import { DECISION_STAGES, INTERVIEW_OUTCOMES, PIPELINE_STATUSES, ROUND_TYPES, STAGE_OUTCOMES } from "@placement/shared";

/** 0-based column index within a sheet. */
const column = z.number().int().min(0).max(199);
const sheetRef = { sheet: z.string().min(1).max(200), headerRow: z.number().int().min(1).max(1000) };
const matchKey = z.enum(["candidateId", "email", "mobile"]);

export const batchIdParamsSchema = z.object({ batchId: z.uuid() });
export const rowParamsSchema = z.object({ batchId: z.uuid(), rowId: z.uuid() });

export const uploadQuerySchema = z.object({ target: z.enum(["INTERNAL_SCREENING", "COMPANY_PIPELINE"]) });

export const previewQuerySchema = z.object({
  sheet: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export const valuesQuerySchema = z.object({
  sheet: z.string().min(1).max(200),
  headerRow: z.coerce.number().int().min(1).max(1000),
  columns: z.string().regex(/^\d{1,3}(,\d{1,3})*$/).transform((value) => value.split(",").map(Number)),
});

export const rowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  filter: z.enum(["all", "errors", "warnings", "excluded", "changes"]).default("all"),
  role: z.string().max(60).optional(),
});

// ── Internal sheet ──

const applicationColumns = z
  .object({
    candidateId: column.optional(),
    fullName: column,
    email: column.optional(),
    mobile: column.optional(),
    product: column.optional(),
    appliedAt: column.optional(),
    resumeUrl: column.optional(),
    gender: column.optional(),
    city: column.optional(),
    state: column.optional(),
    college: column.optional(),
    degree: column.optional(),
    department: column.optional(),
    graduationYear: column.optional(),
    academicScore: column.optional(),
    jobId: column.optional(),
  })
  .refine((columns) => columns.candidateId !== undefined || columns.email !== undefined || columns.mobile !== undefined, {
    message: "Choose at least one column that identifies the candidate: Candidate ID, email or mobile.",
  });

const stageSheet = z.object({
  mode: z.literal("SHEET"),
  ...sheetRef,
  matchBy: matchKey,
  matchColumn: column,
  /** Without a decision column, every listed candidate counts as selected. */
  decisionColumn: column.optional(),
  valueMap: z.record(z.string().max(100), z.enum(STAGE_OUTCOMES)).default({}),
  priorityColumn: column.optional(),
  techScoreColumn: column.optional(),
  commScoreColumn: column.optional(),
  reasonColumn: column.optional(),
  remarksColumn: column.optional(),
});

const stageMapping = z.discriminatedUnion("mode", [
  stageSheet,
  z.object({ mode: z.literal("NOT_CONDUCTED") }),
  z.object({ mode: z.literal("MANUAL") }),
  z.object({ mode: z.literal("UNCHANGED") }),
]);

export const internalMappingSchema = z.object({
  applications: z.object({ ...sheetRef, columns: applicationColumns }),
  productsLookup: z
    .object({ ...sheetRef, keyType: matchKey, keyColumn: column, productColumn: column })
    .optional(),
  stages: z.object(Object.fromEntries(DECISION_STAGES.map((stage) => [stage, stageMapping])) as Record<(typeof DECISION_STAGES)[number], typeof stageMapping>),
  /** Use rows whose Job ID belongs to a different job request (e.g. a re-used earlier sheet). */
  acceptOtherJobIds: z.boolean().default(false),
  /** Let the sheet replace decisions a PSM entered by hand. */
  overwriteManualDecisions: z.boolean().default(false),
});

// ── Company sheet ──

const companyTab = z.object({
  ...sheetRef,
  columns: z
    .object({ fullName: column.optional(), email: column.optional(), mobile: column.optional() })
    .refine((columns) => columns.email !== undefined || columns.mobile !== undefined, {
      message: "Choose the email or mobile column so profiles can be matched.",
    }),
  rounds: z
    .array(z.object({ column, roundName: z.string().trim().min(1).max(80), roundType: z.enum(ROUND_TYPES).default("OTHER") }))
    .max(20)
    .default([]),
  finalStatusColumn: column.optional(),
});

export const companyMappingSchema = z.object({
  tabs: z.array(companyTab).min(1).max(20),
  roundValueMap: z.record(z.string().max(100), z.enum([...INTERVIEW_OUTCOMES, "IGNORE"])).default({}),
  finalValueMap: z.record(z.string().max(100), z.enum([...PIPELINE_STATUSES, "IGNORE"])).default({}),
  /** Add the job's tech stack to matched candidates' skills. */
  addJobSkills: z.boolean().default(true),
  /** Manual matches chosen by the PSM: "<sheet>#<row>" → application ID. */
  overrides: z.record(z.string().max(220), z.uuid()).default({}),
});

export const updateRowSchema = z
  .object({
    included: z.boolean().optional(),
    applicationId: z.uuid().nullable().optional(),
  })
  .refine((value) => value.included !== undefined || value.applicationId !== undefined, { message: "Nothing to change." });

export const approveSchema = z.object({ notes: z.string().trim().max(1000).optional() });

export type InternalMapping = z.infer<typeof internalMappingSchema>;
export type StageSheetMapping = z.infer<typeof stageSheet>;
export type CompanyMapping = z.infer<typeof companyMappingSchema>;
export type RowsQuery = z.infer<typeof rowsQuerySchema>;
export type ValuesQuery = z.infer<typeof valuesQuerySchema>;
export type PreviewQuery = z.infer<typeof previewQuerySchema>;
export type UpdateRowInput = z.infer<typeof updateRowSchema>;
