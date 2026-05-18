-- AlterTable
ALTER TABLE "action_plans" ADD COLUMN     "linked_primary_id" UUID;

-- CreateIndex
CREATE INDEX "action_plans_linked_primary_id_idx" ON "action_plans"("linked_primary_id");

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_linked_primary_id_fkey" FOREIGN KEY ("linked_primary_id") REFERENCES "action_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
