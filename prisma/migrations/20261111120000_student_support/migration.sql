-- Per-student Guidance and RSA (rejection section analysis): a status from a
-- team-managed list plus any number of contributors. Replaces CandidateGuidance
-- (one giver, no status); its rows are carried over as Guidance "Done".

-- CreateEnum
CREATE TYPE "StudentSupportKind" AS ENUM ('GUIDANCE', 'RSA');

-- CreateTable
CREATE TABLE "SupportStatusOption" (
    "id" UUID NOT NULL,
    "kind" "StudentSupportKind" NOT NULL,
    "label" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'slate',
    "countsAsDone" BOOLEAN NOT NULL DEFAULT false,
    "needsContributor" BOOLEAN NOT NULL DEFAULT false,
    "needsNote" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportStatusOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSupport" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "kind" "StudentSupportKind" NOT NULL,
    "statusId" UUID NOT NULL,
    "doneOn" DATE,
    "otherContributors" TEXT,
    "notes" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSupportContributor" (
    "supportId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "StudentSupportContributor_pkey" PRIMARY KEY ("supportId","userId")
);

-- CreateIndex
CREATE INDEX "SupportStatusOption_kind_archivedAt_sortOrder_idx" ON "SupportStatusOption"("kind", "archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSupport_applicationId_kind_key" ON "StudentSupport"("applicationId", "kind");

-- CreateIndex
CREATE INDEX "StudentSupport_jobRequestId_kind_statusId_idx" ON "StudentSupport"("jobRequestId", "kind", "statusId");

-- CreateIndex
CREATE INDEX "StudentSupport_statusId_idx" ON "StudentSupport"("statusId");

-- CreateIndex
CREATE INDEX "StudentSupportContributor_userId_idx" ON "StudentSupportContributor"("userId");

-- AddForeignKey
ALTER TABLE "SupportStatusOption" ADD CONSTRAINT "SupportStatusOption_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "SupportStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupport" ADD CONSTRAINT "StudentSupport_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupportContributor" ADD CONSTRAINT "StudentSupportContributor_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "StudentSupport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSupportContributor" ADD CONSTRAINT "StudentSupportContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Starting status list for both tasks; the team edits it in the app.
INSERT INTO "SupportStatusOption" ("id", "kind", "label", "tone", "countsAsDone", "needsContributor", "needsNote", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), k.kind::"StudentSupportKind", s.label, s.tone, s.done, s.person, s.note, s.sort, CURRENT_TIMESTAMP
FROM (VALUES ('GUIDANCE'), ('RSA')) AS k(kind)
CROSS JOIN (VALUES
    ('Not done',              'rose',    false, false, false, 1),
    ('Scheduled',             'sky',     false, false, false, 2),
    ('Partly done',           'amber',   false, true,  false, 3),
    ('Done',                  'emerald', true,  true,  false, 4),
    ('Not needed',            'slate',   false, false, false, 5),
    ('Student didn''t attend', 'orange',  false, false, false, 6),
    ('Other',                 'violet',  false, false, true,  7)
) AS s(label, tone, done, person, note, sort);

-- Carry over per-student guidance (the same id keeps the contributor link simple).
INSERT INTO "StudentSupport" ("id", "applicationId", "jobRequestId", "kind", "statusId", "doneOn", "notes", "updatedById", "createdAt", "updatedAt")
SELECT g."id", g."applicationId", g."jobRequestId", 'GUIDANCE', o."id", g."givenOn", g."notes", g."givenById", g."createdAt", g."updatedAt"
FROM "CandidateGuidance" g
JOIN "SupportStatusOption" o ON o."kind" = 'GUIDANCE' AND o."label" = 'Done';

INSERT INTO "StudentSupportContributor" ("supportId", "userId")
SELECT g."id", g."givenById" FROM "CandidateGuidance" g;

-- DropTable
DROP TABLE "CandidateGuidance";
