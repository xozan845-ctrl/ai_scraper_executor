-- CreateIndex
CREATE INDEX "AIInteraction_jobId_idx" ON "AIInteraction"("jobId");

-- CreateIndex
CREATE INDEX "Command_jobId_idx" ON "Command"("jobId");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_sessionId_idx" ON "Job"("sessionId");

-- CreateIndex
CREATE INDEX "JobError_jobId_idx" ON "JobError"("jobId");

-- CreateIndex
CREATE INDEX "Page_jobId_idx" ON "Page"("jobId");

-- CreateIndex
CREATE INDEX "Result_jobId_idx" ON "Result"("jobId");

-- CreateIndex
CREATE INDEX "ScrapingPlan_jobId_idx" ON "ScrapingPlan"("jobId");

-- CreateIndex
CREATE INDEX "Session_domain_updatedAt_idx" ON "Session"("domain", "updatedAt");

-- CreateIndex
CREATE INDEX "SessionMessage_sessionId_idx" ON "SessionMessage"("sessionId");
