import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { getOwnershipFilter } from "../../../../../lib/reports/templates";

const ON_TIME_BUFFER_DAYS = 3;

function isoToDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);

    const searchParams = request.nextUrl.searchParams;
    const fromDate = isoToDate(searchParams.get("from"));
    const toDate = isoToDate(searchParams.get("to"));

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "Missing from/to" }, { status: 400 });
    }

    const toEod = new Date(toDate);
    toEod.setUTCHours(23, 59, 59, 999);

    const ownership = getOwnershipFilter(currentUser.id, currentUser.role);

    // ── Portfolio stats ─────────────────────────────────────────────────
    const [openCount, closedCount, overdueCount] = await Promise.all([
      prisma.action_plans.count({
        where: {
          is_deleted: false,
          status: { in: ["NotStarted", "InProgress", "PendingValidation"] },
          ...ownership,
        },
      }),
      prisma.action_plans.count({
        where: {
          is_deleted: false,
          status: { in: ["Closed", "RiskAccepted", "Dropped"] },
          ...ownership,
        },
      }),
      prisma.action_plans.count({
        where: {
          is_deleted: false,
          status: { in: ["NotStarted", "InProgress", "PendingValidation"] },
          current_target_date: { lt: toEod },
          ...ownership,
        },
      }),
    ]);

    // ── Overdue buckets ─────────────────────────────────────────────────
    const overduePlans = await prisma.action_plans.findMany({
      where: {
        is_deleted: false,
        status: { in: ["NotStarted", "InProgress", "PendingValidation"] },
        current_target_date: { lt: toEod },
        ...ownership,
      },
      select: { current_target_date: true },
    });

    let over90 = 0;
    let over30 = 0;
    let under30 = 0;
    for (const p of overduePlans) {
      if (!p.current_target_date) continue;
      const days = Math.floor((toEod.getTime() - p.current_target_date.getTime()) / 86_400_000);
      if (days > 90) over90++;
      else if (days >= 30) over30++;
      else under30++;
    }

    // ── Closure stats ───────────────────────────────────────────────────
    const closedInPeriod = await prisma.action_plans.findMany({
      where: {
        is_deleted: false,
        closed_at: { gte: fromDate, lte: toEod },
        ...ownership,
      },
      select: { closed_at: true, original_target_date: true },
    });

    let closureOnTime = 0;
    let closureLate = 0;
    for (const p of closedInPeriod) {
      if (!p.closed_at || !p.original_target_date) {
        closureOnTime++;
        continue;
      }
      const daysLate = Math.floor(
        (p.closed_at.getTime() - p.original_target_date.getTime()) / 86_400_000,
      );
      if (daysLate <= ON_TIME_BUFFER_DAYS) closureOnTime++;
      else closureLate++;
    }

    return NextResponse.json({
      portfolio: { open: openCount, overdue: overdueCount, closed: closedCount },
      overdue: { over90, over30, under30 },
      closure: { onTime: closureOnTime, late: closureLate, total: closedInPeriod.length },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
