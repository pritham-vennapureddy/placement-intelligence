import { z } from "zod";
import { JOB_REQUEST_STATUSES, parseHubspotRecordId } from "@placement/shared";
import { paginationQuerySchema } from "../../utils/pagination.js";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null).nullable().optional();
const optionalUrl = z.url().max(500).nullable().optional().or(z.literal("").transform(() => null));
const isoDate = z.iso.date();

/** A HubSpot deal link or bare ID, normalised to the numeric ID (or null to clear it). */
const hubspotDeal = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const id = parseHubspotRecordId(value, "deal");
    if (!id) {
      context.addIssue({ code: "custom", message: "Paste a HubSpot deal link (…/record/0-3/…) or its numeric ID." });
      return z.NEVER;
    }
    return id;
  });

export const jobRequestIdParamsSchema = z.object({ jobRequestId: z.uuid() });

export const listJobRequestsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(JOB_REQUEST_STATUSES).optional(),
  view: z.enum(["active", "closed", "all"]).default("active"),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  productId: z.uuid().optional(),
  skill: z.string().trim().toLowerCase().max(80).optional(),
});

const jobFields = {
  // Generated in HubSpot; stored lower-case so lookups ignore case.
  jobId: z.uuid({ message: "Enter the Job ID from HubSpot (a UUID such as 78e5a531-6ff2-…)." }).transform((value) => value.toLowerCase()),
  hubspotDeal,
  companyId: z.uuid(),
  roleTitle: z.string().trim().min(2).max(160),
  techStack: z.array(z.string().trim().min(1).max(80)).min(1, "Add at least one skill.").max(30),
  openings: z.number().int().min(1).max(10000),
  requiredCandidateCount: z.number().int().min(1).max(100000),
  description: z.string().trim().max(10000),
  requestDate: isoDate,
  deadline: isoDate.nullable().optional(),
  timeline: optionalText(80),
  shortlistingMechanism: optionalText(500),
  companyRemarks: optionalText(2000),
  companySheetUrl: optionalUrl,
  internalSheetUrl: optionalUrl,
  eligibleProductIds: z.array(z.uuid()).max(50),
};

const deadlineAfterRequest = (value: { requestDate?: string | undefined; deadline?: string | null | undefined }) =>
  !value.requestDate || !value.deadline || value.deadline >= value.requestDate;

export const createJobRequestSchema = z
  .object({
    ...jobFields,
    // Defaults live here, not in jobFields: `.partial()` would still apply
    // them on update and wipe stored values.
    description: jobFields.description.default(""),
    eligibleProductIds: jobFields.eligibleProductIds.default([]),
    psmOwnerId: z.uuid().optional(),
    status: z.enum(["DRAFT", "OPEN"]).default("OPEN"),
  })
  .refine(deadlineAfterRequest, { message: "The deadline cannot be before the request date.", path: ["deadline"] });

export const updateJobRequestSchema = z
  .object(jobFields)
  .omit({ companyId: true })
  .partial()
  .refine(deadlineAfterRequest, { message: "The deadline cannot be before the request date.", path: ["deadline"] });

export const changeStatusSchema = z.object({
  status: z.enum(JOB_REQUEST_STATUSES),
  reason: z.string().trim().max(1000).optional(),
});

export const reassignOwnerSchema = z.object({
  psmOwnerId: z.uuid(),
  notes: z.string().trim().max(1000).optional(),
});

export type ListJobRequestsQuery = z.infer<typeof listJobRequestsQuerySchema>;
export type CreateJobRequestInput = z.infer<typeof createJobRequestSchema>;
export type UpdateJobRequestInput = z.infer<typeof updateJobRequestSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type ReassignOwnerInput = z.infer<typeof reassignOwnerSchema>;
