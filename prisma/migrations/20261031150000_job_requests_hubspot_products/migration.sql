-- CreateEnum
CREATE TYPE "CandidateCategory" AS ENUM ('ACADEMY', 'ACADEMY_INTENSIVE', 'EXTERNAL');

-- DropForeignKey
ALTER TABLE "JobRequest" DROP CONSTRAINT "JobRequest_productId_fkey";

-- DropIndex
DROP INDEX "JobRequest_productId_status_idx";

-- AlterTable
ALTER TABLE "JobRequest" DROP COLUMN "productId",
DROP COLUMN "techStack",
ADD COLUMN     "companyRemarks" TEXT,
ADD COLUMN     "companySheetUrl" TEXT,
ADD COLUMN     "hubspotDealId" TEXT,
ADD COLUMN     "internalSheetUrl" TEXT,
ADD COLUMN     "shortlistingMechanism" TEXT,
ADD COLUMN     "timeline" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" "CandidateCategory" NOT NULL,
ADD COLUMN     "code" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "JobRequestProduct" (
    "jobRequestId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "JobRequestProduct_pkey" PRIMARY KEY ("jobRequestId","productId")
);

-- CreateIndex
CREATE INDEX "JobRequestProduct_productId_idx" ON "JobRequestProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequest_hubspotDealId_key" ON "JobRequest"("hubspotDealId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- AddForeignKey
ALTER TABLE "JobRequestProduct" ADD CONSTRAINT "JobRequestProduct_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequestProduct" ADD CONSTRAINT "JobRequestProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
