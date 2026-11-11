import {
  COMPANY_PROCESS_PHASES,
  isRoundPhase,
  STUDENT_SUPPORT_KINDS,
  SUPPORT_TONES,
} from "@placement/shared";
import { z } from "zod";

export const jobParamsSchema = z.object({ jobRequestId: z.uuid() });
export const sessionParamsSchema = z.object({ sessionId: z.uuid() });
export const applicationParamsSchema = z.object({ applicationId: z.uuid() });

export const processStatusSchema = z
  .object({
    phase: z.enum(COMPANY_PROCESS_PHASES),
    /** Required for the round phases: which of the job's rounds. */
    roundId: z.uuid().nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(({ phase, roundId }) => !isRoundPhase(phase) || Boolean(roundId), { message: "Choose the company round.", path: ["roundId"] });

const givenOn = z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), { message: "The date cannot be in the future." });

export const guidanceSessionSchema = z.object({
  givenOn,
  notes: z.string().trim().max(1000).optional(),
});

export const supportParamsSchema = z.object({ applicationId: z.uuid(), kind: z.enum(STUDENT_SUPPORT_KINDS) });

/** Status rules (needs a contributor / a note) live on each status and are checked by the service. */
export const studentSupportSchema = z.object({
  statusId: z.uuid(),
  /** Team members who contributed; may be empty when only outside names apply. */
  contributorIds: z.array(z.uuid()).max(20).default([]),
  /** People without an account, e.g. "Ravi (trainer), alumni panel". */
  otherContributors: z.string().trim().max(300).nullable().optional(),
  doneOn: givenOn.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** The same change for several students of one job (e.g. everyone in a drive session). */
export const bulkStudentSupportSchema = studentSupportSchema.extend({
  kind: z.enum(STUDENT_SUPPORT_KINDS),
  applicationIds: z.array(z.uuid()).min(1).max(500),
});

export const statusOptionParamsSchema = z.object({ optionId: z.uuid() });

const statusOptionFields = {
  label: z.string().trim().min(1).max(60),
  tone: z.enum(SUPPORT_TONES),
  countsAsDone: z.boolean(),
  needsContributor: z.boolean(),
  needsNote: z.boolean(),
};

export const createStatusOptionSchema = z.object({
  kind: z.enum(STUDENT_SUPPORT_KINDS),
  ...statusOptionFields,
  tone: statusOptionFields.tone.default("slate"),
  countsAsDone: statusOptionFields.countsAsDone.default(false),
  needsContributor: statusOptionFields.needsContributor.default(false),
  needsNote: statusOptionFields.needsNote.default(false),
});

export const updateStatusOptionSchema = z
  .object({
    label: statusOptionFields.label.optional(),
    tone: statusOptionFields.tone.optional(),
    countsAsDone: statusOptionFields.countsAsDone.optional(),
    needsContributor: statusOptionFields.needsContributor.optional(),
    needsNote: statusOptionFields.needsNote.optional(),
    /** Brings back a deleted status. */
    restore: z.literal(true).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: "Nothing to change." });

export const reorderStatusOptionsSchema = z.object({
  kind: z.enum(STUDENT_SUPPORT_KINDS),
  ids: z.array(z.uuid()).min(1).max(100),
});

export const guidanceViewQuerySchema = z.object({
  /** "shortlisted" (SP-selected or nominated, the default) or every applicant. */
  students: z.enum(["shortlisted", "all"]).default("shortlisted"),
});

export const guidanceJobSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export const myWorkQuerySchema = z.object({
  /** Administrators and managers may look at another PSM's page. */
  ownerId: z.uuid().optional(),
});

export type ProcessStatusInput = z.infer<typeof processStatusSchema>;
export type GuidanceSessionInput = z.infer<typeof guidanceSessionSchema>;
export type StudentSupportInput = z.infer<typeof studentSupportSchema>;
export type BulkStudentSupportInput = z.infer<typeof bulkStudentSupportSchema>;
export type GuidanceViewQuery = z.infer<typeof guidanceViewQuerySchema>;
export type CreateStatusOptionInput = z.infer<typeof createStatusOptionSchema>;
export type UpdateStatusOptionInput = z.infer<typeof updateStatusOptionSchema>;
export type ReorderStatusOptionsInput = z.infer<typeof reorderStatusOptionsSchema>;
export type MyWorkQuery = z.infer<typeof myWorkQuerySchema>;
