CREATE TYPE "CandidatePoolType" AS ENUM ('BUCKET', 'TR', 'COMPETENCY');

CREATE TABLE "CandidatePoolMembership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateCode" TEXT NOT NULL,
    "candidateId" UUID,
    "poolType" "CandidatePoolType" NOT NULL,
    "sourceConnectionId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidatePoolMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CandidatePoolMembership_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CandidatePoolMembership_sourceConnectionId_fkey" FOREIGN KEY ("sourceConnectionId") REFERENCES "SheetConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CandidatePoolMembership_candidateCode_poolType_sourceConnectionId_key" ON "CandidatePoolMembership"("candidateCode", "poolType", "sourceConnectionId");
CREATE INDEX "CandidatePoolMembership_candidateId_poolType_idx" ON "CandidatePoolMembership"("candidateId", "poolType");
CREATE INDEX "CandidatePoolMembership_sourceConnectionId_poolType_idx" ON "CandidatePoolMembership"("sourceConnectionId", "poolType");
