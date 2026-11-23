-- Job type on the job request (full-time, internship, internship to full-time, contract). Optional.
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'INTERNSHIP', 'INTERNSHIP_TO_FULL_TIME', 'CONTRACT');
ALTER TABLE "JobRequest" ADD COLUMN "jobType" "JobType";
