import { DECISION_STAGES } from "@placement/shared";
import { z } from "zod";

export const addApplicationSchema = z
  .object({
    recruitmentBatchId: z.uuid().optional(),
    candidateId: z.uuid().optional(),
    candidate: z
      .object({
        candidateCode: z.string().trim().max(80).optional(),
        fullName: z.string().trim().min(2).max(160),
        email: z.string().trim().max(254).optional(),
        mobile: z.string().trim().max(20).optional(),
        productId: z.uuid().optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.candidateId) !== Boolean(value.candidate), { message: "Choose an existing candidate or enter a new one." });

export const carryOverSchema = z.object({
  fromJobRequestId: z.uuid(),
  recruitmentBatchId: z.uuid().optional(),
  applicationIds: z.array(z.uuid()).min(1).max(500),
});

export const carryOverCandidatesQuerySchema = z.object({
  fromJobRequestId: z.uuid(),
  stage: z.enum(DECISION_STAGES).optional(),
  outcome: z.enum(["SELECTED", "REJECTED", "ON_HOLD", "PENDING", "NO_SHOW", "WITHDRAWN"]).optional(),
});

export type AddApplicationInput = z.infer<typeof addApplicationSchema>;
export type CarryOverInput = z.infer<typeof carryOverSchema>;
export type CarryOverCandidatesQuery = z.infer<typeof carryOverCandidatesQuerySchema>;
