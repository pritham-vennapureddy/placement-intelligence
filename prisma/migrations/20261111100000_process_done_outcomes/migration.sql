-- Company process: split "Process completed" into hired / not hired. No rows used COMPLETED, and RENAME keeps any history rows valid.
ALTER TYPE "CompanyProcessPhase" RENAME VALUE 'COMPLETED' TO 'PROCESS_DONE_HIRED';
ALTER TYPE "CompanyProcessPhase" ADD VALUE IF NOT EXISTS 'PROCESS_DONE_NOT_HIRED' AFTER 'PROCESS_DONE_HIRED';
