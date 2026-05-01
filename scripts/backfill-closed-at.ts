import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const loadEnv = process as typeof process & {
  loadEnvFile?: (path?: string) => void;
};

try {
  loadEnv.loadEnvFile?.(".env");
} catch {
  // The script can also rely on DATABASE_URL being supplied by the shell.
}

const adapter = new PrismaPg(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/ia_remediation",
);
const prisma = new PrismaClient({ adapter });

async function main() {
  const closedActionPlans = await prisma.action_plans.findMany({
    where: {
      status: "Closed",
    },
    select: {
      id: true,
      closed_at: true,
      updated_at: true,
      status_history: {
        where: {
          to_status: "Closed",
        },
        orderBy: {
          changed_at: "desc",
        },
        take: 1,
        select: {
          changed_at: true,
        },
      },
    },
  });

  let updatedFromStatusHistory = 0;
  let fellBackToUpdatedAt = 0;
  let skippedAlreadyClosedAt = 0;

  for (const actionPlan of closedActionPlans) {
    if (actionPlan.closed_at) {
      skippedAlreadyClosedAt += 1;
      continue;
    }

    const latestClosedStatus = actionPlan.status_history[0];
    const closedAt = latestClosedStatus?.changed_at ?? actionPlan.updated_at;

    await prisma.action_plans.update({
      where: {
        id: actionPlan.id,
      },
      data: {
        closed_at: closedAt,
      },
    });

    if (latestClosedStatus) {
      updatedFromStatusHistory += 1;
    } else {
      fellBackToUpdatedAt += 1;
    }
  }

  console.log(`Closed action plans found: ${closedActionPlans.length}`);
  console.log(`Updated from status_history: ${updatedFromStatusHistory}`);
  console.log(`Fell back to updated_at: ${fellBackToUpdatedAt}`);
  console.log(`Skipped because closed_at already exists: ${skippedAlreadyClosedAt}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
