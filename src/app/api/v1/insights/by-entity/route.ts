import { NextResponse } from "next/server";

import { CLOSED_STATUSES } from "../../../../../lib/action-plans/access";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const actionPlans = await prisma.action_plans.findMany({
      where: {
        is_deleted: false,
      },
      select: {
        status: true,
        priority: true,
        current_target_date: true,
        action_plan_entities: {
          select: {
            entity: {
              select: {
                id: true,
                code: true,
                full_name: true,
              },
            },
          },
        },
      },
    });
    const map = new Map<
      string,
      {
        entity_code: string;
        entity_full_name: string;
        total: number;
        open: number;
        overdue: number;
        high_priority: number;
        closed: number;
      }
    >();

    actionPlans.forEach((actionPlan) => {
      actionPlan.action_plan_entities.forEach(({ entity }) => {
        const row =
          map.get(entity.id) ??
          {
            entity_code: entity.code,
            entity_full_name: entity.full_name,
            total: 0,
            open: 0,
            overdue: 0,
            high_priority: 0,
            closed: 0,
          };
        const isClosed = CLOSED_STATUSES.includes(actionPlan.status);

        row.total += 1;
        if (!isClosed) row.open += 1;
        if (isClosed) row.closed += 1;
        if (actionPlan.priority === "High") row.high_priority += 1;
        if (
          actionPlan.current_target_date &&
          actionPlan.current_target_date < today &&
          !isClosed
        ) {
          row.overdue += 1;
        }
        map.set(entity.id, row);
      });
    });

    return NextResponse.json({
      entities: [...map.values()].sort((left, right) => right.overdue - left.overdue),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
