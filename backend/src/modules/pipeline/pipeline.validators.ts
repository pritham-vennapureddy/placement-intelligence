import { z } from "zod";
import { INTERVIEW_OUTCOMES, PIPELINE_STATUSES, ROUND_TYPES } from "@placement/shared";

export const jobParamsSchema = z.object({ jobRequestId: z.uuid() });
export const roundParamsSchema = jobParamsSchema.extend({ roundId: z.uuid() });
export const nominationParamsSchema = jobParamsSchema.extend({ nominationId: z.uuid() });
export const interviewParamsSchema = nominationParamsSchema.extend({ roundId: z.uuid() });

export const createRoundSchema = z.object({
  name: z.string().trim().min(1).max(80),
  roundType: z.enum(ROUND_TYPES).default("OTHER"),
});

export const updateRoundSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), roundType: z.enum(ROUND_TYPES).optional() })
  .refine((value) => value.name !== undefined || value.roundType !== undefined, { message: "Nothing to change." });

export const reorderRoundsSchema = z.object({ roundIds: z.array(z.uuid()).min(1).max(30) });

export const nominateSchema = z.object({
  applicationIds: z.array(z.uuid()).min(1).max(500),
  remarks: z.string().trim().max(1000).optional(),
});

export const pipelineStatusSchema = z.object({
  status: z.enum(PIPELINE_STATUSES),
  /** When it happened (offer date, joining date…); defaults to now. */
  date: z.iso.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const withdrawSchema = z.object({ notes: z.string().trim().min(2, "Say why the nomination is withdrawn.").max(1000) });

export const interviewSchema = z.object({
  outcome: z.enum(INTERVIEW_OUTCOMES),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  interviewerName: z.string().trim().max(160).nullable().optional(),
  feedback: z.string().trim().max(2000).nullable().optional(),
  rejectionReason: z.string().trim().max(1000).nullable().optional(),
});

export type CreateRoundInput = z.infer<typeof createRoundSchema>;
export type UpdateRoundInput = z.infer<typeof updateRoundSchema>;
export type NominateInput = z.infer<typeof nominateSchema>;
export type PipelineStatusInput = z.infer<typeof pipelineStatusSchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
