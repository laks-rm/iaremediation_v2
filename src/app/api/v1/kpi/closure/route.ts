import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../lib/db/prisma";
import {
  ClosurePeriod,
  getClosureKpiByDimension,
  getOverallClosureKpi,
} from "../../../../../lib/kpi/closure";

function parseDateParam(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function parsePeriod(searchParams: URLSearchParams): ClosurePeriod | { error: string } {
  const periodType = searchParams.get("period_type");

  if (periodType === "as_on") {
    const date = parseDateParam(searchParams.get("date"));
    return date ? { type: "as_on", date: endOfUtcDay(date) } : { error: "date is required" };
  }

  if (periodType === "range") {
    const from = parseDateParam(searchParams.get("from"));
    const to = parseDateParam(searchParams.get("to"));

    if (!from) {
      return { error: "from is required" };
    }
    if (!to) {
      return { error: "to is required" };
    }

    return { type: "range", from: startOfUtcDay(from), to: endOfUtcDay(to) };
  }

  return { error: "period_type must be as_on or range" };
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const period = parsePeriod(request.nextUrl.searchParams);

  if ("error" in period) {
    return NextResponse.json({ error: period.error }, { status: 400 });
  }

  try {
    const [overall, byAuditType, byAuditName, byFollowUpAuditor, byDepartment] = await Promise.all([
      getOverallClosureKpi(period, prisma),
      getClosureKpiByDimension("audit_type", period, prisma),
      getClosureKpiByDimension("audit_name", period, prisma),
      getClosureKpiByDimension("follow_up_auditor", period, prisma),
      getClosureKpiByDimension("department", period, prisma),
    ]);

    return NextResponse.json({
      period,
      overall,
      byAuditType,
      byAuditName,
      byFollowUpAuditor,
      byDepartment,
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute closure KPIs" }, { status: 500 });
  }
}
