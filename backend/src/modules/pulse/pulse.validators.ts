import { CRM_CHANNELS, isMonthKey, POTENTIAL_COMPANY_STATUSES } from "@placement/shared";
import { z } from "zod";

const month = z.string().refine(isMonthKey, { message: "Use a month like 2026-11." });
const notFuture = z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), { message: "The date cannot be in the future." });
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => /^https?:\/\/\S+$/i.test(value), { message: "Paste the full link, starting with https://." });

export const monthQuerySchema = z.object({ month });
export const entryParamsSchema = z.object({ entryId: z.uuid() });
export const jobParamsSchema = z.object({ jobRequestId: z.uuid() });
export const remarkParamsSchema = z.object({ jobRequestId: z.uuid(), remarkId: z.uuid() });
export const applicationParamsSchema = z.object({ applicationId: z.uuid() });

const entryFields = {
  roleHint: optionalText(200),
  expectedOpenings: z.number().int().min(1).max(10000).nullable().optional(),
  expectedStartDate: z.iso.date().nullable().optional(),
  crmOwnerId: z.uuid().nullable().optional(),
  remarks: optionalText(2000),
};

/** Adds a job drive (picked by its job ID) to a month's potential list; the company comes from the job. */
export const createEntrySchema = z.object({
  month,
  jobRequestId: z.uuid(),
  status: z.enum(POTENTIAL_COMPANY_STATUSES).default("POTENTIAL"),
  ...entryFields,
});

/** Omitted = unchanged, null = cleared. `note` explains a status change and goes to the history. */
export const updateEntrySchema = z.object({
  status: z.enum(POTENTIAL_COMPANY_STATUSES).optional(),
  note: z.string().trim().max(1000).optional(),
  ...entryFields,
});

/** Copies entries into the next month. Without `entryIds`, every still-active entry not yet carried. */
export const carryForwardSchema = z.object({
  fromMonth: month,
  entryIds: z.array(z.uuid()).min(1).max(500).optional(),
});

export const crmRemarkSchema = z.object({
  interactionOn: notFuture,
  channel: z.enum(CRM_CHANNELS).default("CALL"),
  remark: z.string().trim().min(1).max(3000),
  nextStep: optionalText(1000),
});

export const rsaReviewSchema = z.object({
  wentRight: optionalText(5000),
  wentWrong: optionalText(5000),
  actionItems: optionalText(5000),
});

export const RSA_SEGMENTS = ["ACADEMY_OR_POOL", "ACADEMY", "POOL", "EVERYONE"] as const;
export const RSA_PROGRESS = ["ALL", "NOT_STARTED", "IN_PROGRESS", "DONE"] as const;
/** The company's result for the student: not known yet, not selected, or selected. */
export const RSA_RESULTS = ["ALL", "UNKNOWN", "NOT_SELECTED", "SELECTED"] as const;

/** Students the RSA team reviews: shared with the company and not selected. */
export const rsaStudentsQuerySchema = z
  .object({
    from: month.optional(),
    to: month.optional(),
    dateBy: z.enum(["requested", "processEnd"]).default("requested"),
    companyId: z.uuid().optional(),
    segment: z.enum(RSA_SEGMENTS).default("ACADEMY_OR_POOL"),
    progress: z.enum(RSA_PROGRESS).default("ALL"),
    result: z.enum(RSA_RESULTS).default("ALL"),
    reasonTagId: z.union([z.uuid(), z.literal("untagged")]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { message: "`from` must be on or before `to`.", path: ["to"] });

/** The RSA team's report for one student's application. */
export const rsaReportSchema = z.object({
  statusId: z.uuid(),
  reportSummary: optionalText(5000),
  reportUrl: httpUrl.nullable().optional(),
  contributorIds: z.array(z.uuid()).max(20).default([]),
  otherContributors: optionalText(300),
  doneOn: notFuture.nullable().optional(),
  notes: optionalText(1000),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type CarryForwardInput = z.infer<typeof carryForwardSchema>;
export type CrmRemarkInput = z.infer<typeof crmRemarkSchema>;
export type RsaReviewInput = z.infer<typeof rsaReviewSchema>;
export type RsaStudentsQuery = z.infer<typeof rsaStudentsQuerySchema>;
export type RsaReportInput = z.infer<typeof rsaReportSchema>;

/** The RSA team's reason for one student on one drive; null clears it. */
export const rsaReasonSchema = z.object({ rejectionTagId: z.uuid().nullable() });
export type RsaReasonInput = z.infer<typeof rsaReasonSchema>;
