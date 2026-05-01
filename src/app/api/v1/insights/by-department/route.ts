import { ActionPlanStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { CLOSED_STATUSES } from "../../../../../lib/action-plans/access";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const STATUSES: ActionPlanStatus[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "Closed",
  "RiskAccepted",
  "Dropped",
];

function emptyStatusCounts() {
  return STATUSES.reduce<Record<ActionPlanStatus, number>>(
    (counts, status) => {
      counts[status] = 0;
      return counts;
    },
    {} as Record<ActionPlanStatus, number>,
  );
}

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer"]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const actionPlans = await prisma.action_plans.findMany({
      where: {
        is_deleted: false,
      },
      select: {
        status: true,
        current_target_date: true,
        action_plan_owners: {
          where: {
            is_primary: true,
          },
          select: {
            user: {
              select: {
                department: true,
              },
            },
          },
        },
      },
    });

    const map = new Map<string, { department: string; status_counts: Record<ActionPlanStatus, number>; overdue: number; total: number }>();

    actionPlans.forEach((actionPlan) => {
      const department = actionPlan.action_plan_owners[0]?.user.department || "Unassigned";
      const row =
        map.get(department) ??
        {
          department,
          status_counts: emptyStatusCounts(),
          overdue: 0,
          total: 0,
        };

      row.status_counts[actionPlan.status] += 1;
      row.total += 1;
      if (
        actionPlan.current_target_date &&
        actionPlan.current_target_date < today &&
        !CLOSED_STATUSES.includes(actionPlan.status)
      ) {
        row.overdue += 1;
      }
      map.set(department, row);
    });

    return NextResponse.json({
      departments: [...map.values()].sort((left, right) => right.total - left.total),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
