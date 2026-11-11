import { z } from "zod";

const column = z.coerce.number().int().min(0).max(199);

export const previewQuerySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sheet: z.string().trim().min(1).max(200).optional(),
});

export const assessedPoolLookupQuerySchema = z.object({
  search: z.string().trim().min(2).max(120),
});

export const assessedPoolMappingSchema = z.object({
  mobile: column,
  sourceUserId: column.optional(),
  bucketTier: column.optional(),
  tr1Status: column.optional(),
  tr2Status: column.optional(),
  competencyStatus: column.optional(),
  competencyLevel: column.optional(),
  spReason: column.optional(),
});

export const importQuerySchema = previewQuerySchema.extend({
  mapping: z.string().min(2).transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "The column mapping is not valid JSON." });
      return z.NEVER;
    }
  }).pipe(assessedPoolMappingSchema),
});

export const sourceUrlSchema = z.string().trim().min(1).max(500);

export const sourcePreviewBodySchema = z.object({
  url: sourceUrlSchema,
  sheetTitle: z.string().trim().min(1).max(100).optional(),
});

export const sourceConnectBodySchema = z.object({
  url: sourceUrlSchema,
});

export const importParamsSchema = z.object({ importId: z.uuid() });

export type PreviewQuery = z.infer<typeof previewQuerySchema>;
export type AssessedPoolLookupQuery = z.infer<typeof assessedPoolLookupQuerySchema>;
export type ImportQuery = z.infer<typeof importQuerySchema>;
export type AssessedPoolMapping = z.infer<typeof assessedPoolMappingSchema>;
export type SourcePreviewBody = z.infer<typeof sourcePreviewBodySchema>;
export type SourceConnectBody = z.infer<typeof sourceConnectBodySchema>;
