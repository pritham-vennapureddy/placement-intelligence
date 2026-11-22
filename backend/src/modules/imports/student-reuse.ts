import type { Db } from "../../db.js";
import { normalizeMobile } from "../../utils/normalize.js";

/**
 * Students an import planned to create who are already in the dashboard by
 * mobile: typically added by another PSM's import approved while this one was
 * being reviewed. Returns candidate code (lower-case) → the existing student's id,
 * only where exactly one active student has that mobile.
 */
export async function studentsAddedMeanwhile(db: Db, planned: { candidateCode: string; mobile: string | null | undefined }[]): Promise<Map<string, string>> {
  const byMobile = new Map<string, string[]>();
  for (const { candidateCode, mobile } of planned) {
    const key = normalizeMobile(mobile);
    if (key) byMobile.set(key, [...(byMobile.get(key) ?? []), candidateCode.toLowerCase()]);
  }
  if (byMobile.size === 0) return new Map();
  const existing = await db.candidate.findMany({ where: { mobile: { in: [...byMobile.keys()] }, archivedAt: null }, select: { id: true, mobile: true } });
  const idsByMobile = new Map<string, string[]>();
  for (const candidate of existing) {
    const key = normalizeMobile(candidate.mobile);
    if (key) idsByMobile.set(key, [...(idsByMobile.get(key) ?? []), candidate.id]);
  }
  const reused = new Map<string, string>();
  for (const [mobile, codes] of byMobile) {
    const ids = idsByMobile.get(mobile);
    if (ids?.length === 1) for (const code of codes) reused.set(code, ids[0]!);
  }
  return reused;
}
