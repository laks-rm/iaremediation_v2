ALTER TABLE "audit_log" ADD COLUMN "user_agent" TEXT;

CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at" DESC);
CREATE INDEX "audit_log_entity_type_created_at_idx" ON "audit_log"("entity_type", "created_at" DESC);
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at" DESC);
