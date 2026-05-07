-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('Finding', 'OpportunityForImprovement');

-- AlterTable
ALTER TABLE "ai_insights_snapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "finding_type" "FindingType" NOT NULL DEFAULT 'Finding';
