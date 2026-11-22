import type { Db } from "../../db.js";

type StudentDates = { pipelineStatus: string; processStartDate: Date | null; processEndDate: Date | null };

/**
 * A job's company process dates, worked out from its students' dates (nominated,
 * not withdrawn):
 * - start: the earliest student start date;
 * - end: the latest student end date, once every student shared with the company
 *   has one. While anyone shared is still without an end date, the process is
 *   still running and there is no end.
 */
export function deriveJobProcessDates(students: StudentDates[]): { start: Date | null; end: Date | null } {
  const starts = students.flatMap((student) => (student.processStartDate ? [student.processStartDate.getTime()] : []));
  const shared = students.filter((student) => student.pipelineStatus !== "NOT_SUBMITTED");
  const ends = shared.flatMap((student) => (student.processEndDate ? [student.processEndDate.getTime()] : []));
  return {
    start: starts.length ? new Date(Math.min(...starts)) : null,
    end: shared.length > 0 && ends.length === shared.length ? new Date(Math.max(...ends)) : null,
  };
}

/** Recalculates and saves the job's company process start / end from its students' dates. */
export async function syncJobProcessDates(db: Db, jobRequestId: string): Promise<void> {
  const [job, students] = await Promise.all([
    db.jobRequest.findUnique({ where: { id: jobRequestId }, select: { companyProcessStartDate: true, companyProcessEndDate: true } }),
    db.companyNomination.findMany({
      where: { jobRequestId, status: "NOMINATED" },
      select: { pipelineStatus: true, processStartDate: true, processEndDate: true },
    }),
  ]);
  if (!job) return;
  const { start, end } = deriveJobProcessDates(students);
  const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  if (same(start, job.companyProcessStartDate) && same(end, job.companyProcessEndDate)) return;
  await db.jobRequest.update({ where: { id: jobRequestId }, data: { companyProcessStartDate: start, companyProcessEndDate: end } });
}
