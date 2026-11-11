import { z } from "zod";
import { INTERNAL_STAGES, PRIORITIES, SCREENING_SKIP_REASONS, STAGE_OUTCOMES, STAGE_STATUSES } from "@placement/shared";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const jobParamsSchema = z.object({ jobRequestId: z.uuid() });
export const stageParamsSchema = jobParamsSchema.extend({ stage: z.enum(INTERNAL_STAGES) });
export const stageCandidateParamsSchema = stageParamsSchema.extend({ applicationId: z.uuid() });

export const updateProcessSchema = z.object({
  shortlistingNotes: z.string().trim().max(5000).nullable(),
});

export const updateStageSchema = z
  .object({
    status: z.enum(STAGE_STATUSES).optional(),
    statusRemarks: z.string().trim().max(1000).optional(),
    /** Why SC was skipped; used with status NOT_CONDUCTED. */
    skipReason: z.enum(SCREENING_SKIP_REASONS).nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    nextPlannedDate: z.iso.date().nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: "Nothing to change." });

export const stageCandidatesQuerySchema = paginationQuerySchema.extend({
  outcome: z.enum(STAGE_OUTCOMES).optional(),
  search: z.string().trim().max(120).optional(),
});

const score = z.number().min(0).max(10).nullable().optional();

export const decisionSchema = z.object({
  outcome: z.enum(STAGE_OUTCOMES),
  priority: z.enum(PRIORITIES).nullable().optional(),
  techScore: score,
  commScore: score,
  rejectionReason: z.string().trim().max(1000).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

export const addToStageSchema = z.object({
  applicationIds: z.array(z.uuid()).min(1).max(500),
  outcome: z.enum(STAGE_OUTCOMES).default("PENDING"),
});

export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type StageCandidatesQuery = z.infer<typeof stageCandidatesQuerySchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type AddToStageInput = z.infer<typeof addToStageSchema>;
