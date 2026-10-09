ALTER TABLE "Job" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");
