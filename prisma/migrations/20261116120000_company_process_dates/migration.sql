-- Company process start/end dates: per job (company level) and per nominated student.
ALTER TABLE "JobRequest" ADD COLUMN "companyProcessStartDate" DATE;
ALTER TABLE "JobRequest" ADD COLUMN "companyProcessEndDate" DATE;

ALTER TABLE "CompanyNomination" ADD COLUMN "processStartDate" DATE;
ALTER TABLE "CompanyNomination" ADD COLUMN "processEndDate" DATE;
