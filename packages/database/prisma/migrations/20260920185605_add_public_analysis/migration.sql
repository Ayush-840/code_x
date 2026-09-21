-- AlterTable
ALTER TABLE "CodeModule" ADD COLUMN     "readingOrderIndex" INTEGER;

-- CreateTable
CREATE TABLE "PublicAnalysis" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "status" "RepoStatus" NOT NULL DEFAULT 'PENDING',
    "requestIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "claimedByUserId" UUID,
    "repoId" UUID,
    "jobId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAnalysis_fullName_idx" ON "PublicAnalysis"("fullName");

-- CreateIndex
CREATE INDEX "PublicAnalysis_claimedByUserId_idx" ON "PublicAnalysis"("claimedByUserId");

-- CreateIndex
CREATE INDEX "PublicAnalysis_expiresAt_idx" ON "PublicAnalysis"("expiresAt");

-- AddForeignKey
ALTER TABLE "PublicAnalysis" ADD CONSTRAINT "PublicAnalysis_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicAnalysis" ADD CONSTRAINT "PublicAnalysis_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AnalysisJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
