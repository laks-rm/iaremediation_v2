import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../lib/db/prisma";

export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (currentUser.role !== "Auditee") {
    return NextResponse.json({ count: 0 });
  }

  const count = await prisma.action_plans.count({
    where: {
      is_deleted: false,
      status: {
        notIn: ["Closed", "Dropped", "RiskAccepted"],
      },
      action_plan_owners: {
        some: {
          user_id: currentUser.id,
        },
      },
    },
  });

  return NextResponse.json({ count });
}
