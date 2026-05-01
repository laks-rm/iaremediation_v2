CREATE TABLE "ai_insights_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" UUID,
    "trigger" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "model_used" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "ai_insights_snapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_insights_snapshot"
    ADD CONSTRAINT "ai_insights_snapshot_generated_by_fkey"
    FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_insights_snapshot_generated_at_idx" ON "ai_insights_snapshot"("generated_at" DESC);
CREATE INDEX "ai_insights_snapshot_trigger_idx" ON "ai_insights_snapshot"("trigger");
