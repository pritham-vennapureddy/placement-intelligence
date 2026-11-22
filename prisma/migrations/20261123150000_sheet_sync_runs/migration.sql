-- Automatic company-sheet sync: a log of each run, and the user the scheduled runs act as.
CREATE TYPE "SheetSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL');
CREATE TYPE "SheetSyncStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

CREATE TABLE "SheetSyncRun" (
    "id" UUID NOT NULL,
    "trigger" "SheetSyncTrigger" NOT NULL,
    "status" "SheetSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "needsReview" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    CONSTRAINT "SheetSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SheetSyncRun_startedAt_idx" ON "SheetSyncRun"("startedAt");
ALTER TABLE "SheetSyncRun" ADD CONSTRAINT "SheetSyncRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Scheduled syncs record imports as this user. It is inactive and its password is a
-- hash of random bytes nobody knows, so it can never sign in.
INSERT INTO "User" ("id", "email", "fullName", "passwordHash", "isActive", "updatedAt")
VALUES ('00000000-0000-4000-8000-00000000a5c1', 'sheet-sync@system.local', 'Automatic sheet sync',
        '$2b$10$mw8h1YecU86b/bQUNPkehenMbf9jRX77GNBt4w.i.CT5HvOcGPxnS', FALSE, NOW())
ON CONFLICT ("email") DO NOTHING;
