import { DECISION_STAGES, STAGE_OUTCOMES } from "@placement/shared";
import { z } from "zod";

const isoDate = z.iso.date();

export const summaryQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    productId: z.uuid().optional(),
    skill: z.string().trim().toLowerCase().min(1).max(80).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

/** Placement KPIs for jobs requested in [from, to]; the whole history when both are omitted. */
export const placementKpisQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

export const candidateAnalyticsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  recruitmentBatchId: z.uuid().optional(),
  /** Only candidates with this outcome at this stage; NONE means the stage has no record for them. */
  stage: z.enum(DECISION_STAGES).optional(),
  outcome: z.enum([...STAGE_OUTCOMES, "NONE"]).optional(),
  /** Name or mobile number. */
  q: z.string().trim().min(1).max(100).optional(),
}).refine(({ stage, outcome }) => !outcome || Boolean(stage), { message: "Choose a stage to filter by outcome.", path: ["outcome"] });

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type PlacementKpisQuery = z.infer<typeof placementKpisQuerySchema>;
export type CandidateAnalyticsQuery = z.infer<typeof candidateAnalyticsQuerySchema>;
