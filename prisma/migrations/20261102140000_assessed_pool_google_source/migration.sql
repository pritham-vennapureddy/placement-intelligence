-- CreateTable
CREATE TABLE "AssessedPoolSource" (
    "id" UUID NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "spreadsheetTitle" TEXT NOT NULL,
    "sheetTitle" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "connectedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessedPoolSource_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AssessedPoolSource" ADD CONSTRAINT "AssessedPoolSource_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
