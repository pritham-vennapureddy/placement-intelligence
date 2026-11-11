import { z } from "zod";

export const sourceTypes = ["INTERNAL_PROCESS", "COMPANY_PROCESS", "ASSESSED_POOL"] as const;

export const poolWorkflowStages = ["BUCKET_POOL", "TR_POOL", "COMPETENCY_POOL"] as const;

// Saved default tab mappings. Phase 5 replaces these with per-batch
// ImportSheetMapping rows that separate internal stages from company rounds.
export const workflowStages = [
  "APPLICATIONS",
  "ACADEMY",
  "INTENSIVE",
  "EXTERNAL",
  "ASSESSED_POOL",
  "RESUME_SHORTLISTING",
  "SCREENING",
  "ASSIGNMENT",
  "TECHNICAL_ROUND_1",
  "TECHNICAL_ROUND_2",
  "HR_ROUND",
  "FINAL_STATUS",
  "REJECTION_REASON",
  "RSA_ASSESSMENT",
  "ROUND_TRANSCRIPTS",
  ...poolWorkflowStages,
] as const;

export const columnKeys = [
  "candidate_id",
  "full_name",
  "email",
  "cohort",
  "product",
  "company",
  "role",
  "status",
  "application_date",
  "interview_round",
  "rejection_reason",
  "resume_link",
  "assessment_score",
] as const;

export const connectionParamsSchema = z.object({ connectionId: z.uuid() });

export const headerParamsSchema = z.object({
  connectionId: z.uuid(),
  sheetId: z.coerce.number().int().nonnegative(),
});

export const createConnectionSchema = z.object({
  url: z.url(),
  sourceType: z.enum(sourceTypes),
});

export const createMappingSchema = z.object({
  workflowStage: z.enum(workflowStages),
  sheetId: z.number().int().nonnegative(),
  sheetTitle: z.string().min(1).max(100),
  headerRow: z.number().int().min(0).max(500),
  columnMapping: z.partialRecord(z.enum(columnKeys), z.string().max(256)).optional(),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type CreateMappingInput = z.infer<typeof createMappingSchema>;
export type HeaderParams = z.infer<typeof headerParamsSchema>;
