-- Why a profile reached the company without the internal shortlist, with an optional note.
CREATE TYPE "DirectShareReason" AS ENUM ('COMPANY_NO_SHORTLISTING', 'SHARED_BY_OTHER_TEAM', 'COMPANY_SOURCED', 'PRE_ASSESSED', 'LATE_ADDITION', 'OTHER');

ALTER TABLE "CompanyNomination" ADD COLUMN "directShareReason" "DirectShareReason";
ALTER TABLE "CompanyNomination" ADD COLUMN "directShareNote" TEXT;
