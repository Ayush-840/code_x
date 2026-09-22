-- Error category for failed analysis jobs (PRD-I04): lets the frontend
-- distinguish NOT_FOUND / RATE_LIMITED / SYSTEM_ERROR instead of showing one
-- generic "Analysis failed" message for every failure mode.
ALTER TABLE "AnalysisJob" ADD COLUMN     "errorCategory" TEXT;
