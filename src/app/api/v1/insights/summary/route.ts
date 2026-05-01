import { AuditType } from "@prisma/client";
import { NextResponse } from "next/server";

import { CLOSED_STATUSES } from "../../../../../lib/action-plans/access";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const AUDIT_TYPES: AuditType[] = ["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"];

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatWeek(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit" }).format(date);
}

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer"]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eightWeeksAgo = startOfWeek(new Date(Date.now() - 7 * 7 * 24 * 60 * 60 * 1000));

    const [actionPlans, closedHistory] = await Promise.all([
      prisma.action_plans.findMany({
        where: {
          is_deleted: false,
        },
        select: {
          id: true,
          priority: true,
          status: true,
          current_target_date: true,
          finding: {
            select: {
              audit: {
                select: {
                  audit_type: true,
                },
              },
            },
          },
          action_plan_owners: {
            select: {
              id: true,
            },
          },
        },
      }),
      prisma.status_history.findMany({
        where: {
          to_status: "Closed",
          changed_at: {
            gte: eightWeeksAgo,
          },
        },
        select: {
          changed_at: true,
        },
      }),
    ]);

    const quickCounts = {
      overdue: actionPlans.filter(
        (actionPlan) =>
          actionPlan.current_target_date &&
          actionPlan.current_target_date < today &&
          !CLOSED_STATUSES.includes(actionPlan.status),
      ).length,
      high_priority_open: actionPlans.filter(
        (actionPlan) => actionPlan.priority === "High" && !CLOSED_STATUSES.includes(actionPlan.status),
      ).length,
      pending_validation: actionPlans.filter((actionPlan) => actionPlan.status === "PendingValidation").length,
      unassigned: actionPlans.filter((actionPlan) => actionPlan.action_plan_owners.length === 0).length,
    };

    const auditTypeBreakdown = AUDIT_TYPES.map((auditType) => ({
      audit_type: auditType,
      count: actionPlans.filter((actionPlan) => actionPlan.finding.audit?.audit_type === auditType).length,
    }));

    const weekStarts = Array.from({ length: 8 }, (_item, index) => {
      const start = new Date(eightWeeksAgo);
      start.setDate(start.getDate() + index * 7);
      return start;
    });
    const trend = weekStarts.map((weekStart, index) => {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return {
        week: formatWeek(weekStart),
        closed: closedHistory.filter(
          (item) => item.changed_at >= weekStart && item.changed_at < weekEnd,
        ).length,
        sort: index,
      };
    });

    return NextResponse.json({
      quick_counts: quickCounts,
      audit_type_breakdown: auditTypeBreakdown,
      trend,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
