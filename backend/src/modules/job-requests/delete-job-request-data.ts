import type { Db } from "../../db.js";

export async function deleteJobRequestData(db: Db, jobRequestId: string): Promise<void> {
  const batches = await db.importBatch.findMany({ where: { jobRequestId }, select: { id: true } });
  const batchIds = batches.map(({ id }) => id);

  await db.companyInterview.deleteMany({ where: { jobRequestId } });
  await db.companyStageHistory.deleteMany({
    where: { nomination: { jobRequestId } },
  });
  await db.companyNomination.deleteMany({ where: { jobRequestId } });
  await db.internalStageCandidate.deleteMany({ where: { jobRequestId } });
  await db.stageCompletionRecord.deleteMany({
    where: { stage: { jobRequestId } },
  });
  await db.internalProcessStage.deleteMany({ where: { jobRequestId } });
  await db.internalProcess.deleteMany({ where: { jobRequestId } });
  await db.application.deleteMany({ where: { jobRequestId } });
  await db.companyInterviewRound.deleteMany({ where: { jobRequestId } });
  await db.pSMAssignment.deleteMany({ where: { jobRequestId } });

  if (batchIds.length > 0) {
    await db.importApproval.deleteMany({ where: { batchId: { in: batchIds } } });
    await db.importBatch.deleteMany({ where: { id: { in: batchIds } } });
  }

  await db.jobRequest.delete({ where: { id: jobRequestId } });
}
