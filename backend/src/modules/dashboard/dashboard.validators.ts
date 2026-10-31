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

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
