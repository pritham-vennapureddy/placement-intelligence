import { z } from "zod";
import { SCREENING_SKIP_REASONS, DECISION_STAGES, INTERVIEW_OUTCOMES, PIPELINE_STATUSES, ROUND_TYPES, STAGE_OUTCOMES } from "@placement/shared";

/** 0-based column index within a sheet. */
const column = z.number().int().min(0).max(199);
const sheetRef = { sheet: z.string().min(1).max(200), headerRow: z.number().int().min(0).max(1000) };
const matchKey = z.enum(["candidateId", "email", "mobile"]);

export const batchIdParamsSchema = z.object({ batchId: z.uuid() });
export const rowParamsSchema = z.object({ batchId: z.uuid(), rowId: z.uuid() });

export const googleImportSchema = z.object({
  target: z.enum(["INTERNAL_SCREENING", "COMPANY_PIPELINE"]),
  url: z.url().max(1000),
  recruitmentBatchId: z.uuid().optional(),
});

export const googleRefreshSchema = z.object({ target: z.enum(["INTERNAL_SCREENING", "COMPANY_PIPELINE"]), recruitmentBatchId: z.uuid().optional() });

export const previewQuerySchema = z.object({
  sheet: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export const valuesQuerySchema = z.object({
  sheet: z.string().min(1).max(200),
  headerRow: z.coerce.number().int().min(0).max(1000),
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
    fullName: column.optional(),
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
  .refine((columns) => columns.mobile !== undefined, {
    message: "Choose the mobile-number column; mobile is the required candidate identity.",
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
  selectionBasisColumn: column.optional(),
});

const profileLookupMapping = z.object({
  ...sheetRef,
  keyType: matchKey,
  keyColumn: column,
  columns: z.object({
    candidateId: column.optional(),
    fullName: column.optional(),
    email: column.optional(),
    mobile: column.optional(),
    resumeUrl: column.optional(),
    product: column.optional(),
    gender: column.optional(),
    city: column.optional(),
    state: column.optional(),
    college: column.optional(),
    degree: column.optional(),
    department: column.optional(),
    graduationYear: column.optional(),
    academicScore: column.optional(),
  }).refine((columns) => columns.mobile !== undefined, {
    message: "Choose the profile sheet's mobile-number column for candidate matching.",
  }),
});

const stageMapping = z.discriminatedUnion("mode", [
  stageSheet,
  z.object({ mode: z.literal("NOT_CONDUCTED"), reason: z.string().trim().max(1000).optional(), skipReason: z.enum(SCREENING_SKIP_REASONS).optional() }),
  z.object({ mode: z.literal("MANUAL") }),
  z.object({ mode: z.literal("UNCHANGED") }),
]);

const googleStageSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("SHEET"), sheet: z.string().min(1).max(200) }),
  z.object({ mode: z.literal("NOT_CONDUCTED"), reason: z.string().trim().max(1000).optional(), skipReason: z.enum(SCREENING_SKIP_REASONS).optional() }),
  z.object({ mode: z.literal("MANUAL") }),
  z.object({ mode: z.literal("UNCHANGED") }),
]);

export const googleInternalSelectionSchema = z.object({
  applications: z.object({ sheet: z.string().min(1).max(200) }),
  productLookupSheet: z.string().min(1).max(200).nullable().optional(),
  /** True once the PSM has chosen the product tab on the mapping screen. */
  productTabConfirmed: z.boolean().optional(),
  stages: z.object(Object.fromEntries(DECISION_STAGES.map((stage) => [stage, googleStageSelection])) as Record<(typeof DECISION_STAGES)[number], typeof googleStageSelection>),
  acceptOtherJobIds: z.boolean().default(false),
  overwriteManualDecisions: z.boolean().default(false),
});
export type GoogleInternalSelection = z.infer<typeof googleInternalSelectionSchema>;

export const internalMappingSchema = z.object({
  applications: z.object({ ...sheetRef, columns: applicationColumns }),
  profileLookups: z.array(profileLookupMapping).max(50).default([]),
  productsLookup: z
    .object({ ...sheetRef, keyType: matchKey, keyColumn: column, productColumn: column })
    .optional(),
  stages: z.object(Object.fromEntries(DECISION_STAGES.map((stage) => [stage, stageMapping])) as Record<(typeof DECISION_STAGES)[number], typeof stageMapping>),
  /**
   * True once the PSM has chosen the product tab (productsLookup). Applicants
   * not on that tab are External. Unconfirmed, auto-detected choices are
   * re-detected on the next import.
   */
  productTabConfirmed: z.boolean().default(false),
  /** Use rows whose Job ID belongs to a different job request (e.g. a re-used earlier sheet). */
  acceptOtherJobIds: z.boolean().default(false),
  /** Let the sheet replace decisions a PSM entered by hand. */
  overwriteManualDecisions: z.boolean().default(false),
}).refine(
  ({ stages }) => stages.SCREENING_SHORTLIST.mode !== "NOT_CONDUCTED" || Boolean(stages.SCREENING_SHORTLIST.reason),
  { message: "Give a reason when screening was not conducted.", path: ["stages", "SCREENING_SHORTLIST", "reason"] },
);

// ── Company sheet ──

const companyTab = z.object({
  ...sheetRef,
  columns: z
    .object({ fullName: column.optional(), email: column.optional(), mobile: column.optional() })
    .refine((columns) => columns.mobile !== undefined, {
      message: "Choose the mobile-number column; mobile is the required identity for company rows.",
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

export const googleCompanySelectionSchema = z.object({
  tabs: z.array(z.object({ sheet: z.string().min(1).max(200) })).min(1).max(20),
  addJobSkills: z.boolean().default(true),
});
export type GoogleCompanySelection = z.infer<typeof googleCompanySelectionSchema>;

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
