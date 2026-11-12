CREATE TABLE "JobSchedule" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "limits" JSONB,
  "aiProvider" TEXT NOT NULL DEFAULT 'openrouter',
  "aiModel" TEXT,
  "webhookUrl" TEXT,
  "ownerScope" TEXT NOT NULL DEFAULT 'anon',
  "intervalSec" INTEGER NOT NULL,
  "maxRuns" INTEGER,
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "lastJobId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobSchedule_status_nextRunAt_idx" ON "JobSchedule"("status", "nextRunAt");
CREATE INDEX "JobSchedule_ownerScope_createdAt_idx" ON "JobSchedule"("ownerScope", "createdAt");
