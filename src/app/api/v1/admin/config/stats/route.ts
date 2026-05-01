import { NextResponse } from "next/server";

import { CLOSED_STATUSES } from "../../../../../../lib/action-plans/access";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

export async function GET() {
  try {
    await requireAdmin();
    const [totalUsers, activeUsers, totalActionPlans, openActionPlans, totalAudits, totalEntities] =
      await Promise.all([
        prisma.users.count(),
        prisma.users.count({ where: { is_active: true } }),
        prisma.action_plans.count({ where: { is_deleted: false } }),
        prisma.action_plans.count({ where: { is_deleted: false, status: { notIn: CLOSED_STATUSES } } }),
        prisma.audits.count({ where: { is_deleted: false } }),
        prisma.entities.count(),
      ]);

    return NextResponse.json({
      stats: { totalUsers, activeUsers, totalActionPlans, openActionPlans, totalAudits, totalEntities },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
