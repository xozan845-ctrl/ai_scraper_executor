ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN "apiKeyHash" TEXT,
  ADD COLUMN "bootstrap" BOOLEAN,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "Job" ADD COLUMN "ownerScope" TEXT NOT NULL DEFAULT 'anon';
ALTER TABLE "Session" ADD COLUMN "ownerScope" TEXT NOT NULL DEFAULT 'anon';

CREATE UNIQUE INDEX "User_apiKeyHash_key" ON "User"("apiKeyHash");
CREATE UNIQUE INDEX "User_bootstrap_key" ON "User"("bootstrap");
CREATE INDEX "Job_ownerScope_createdAt_idx" ON "Job"("ownerScope", "createdAt");
CREATE INDEX "Session_ownerScope_updatedAt_idx" ON "Session"("ownerScope", "updatedAt");
