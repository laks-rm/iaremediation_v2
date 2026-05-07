import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../lib/db/prisma";
import { getAllClosureKpis } from "../../../../../lib/kpi/closure";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parsePeriod(searchParams: URLSearchParams): { from: Date; to: Date } | { error: string } {
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (!fromStr) {
    return { error: "from is required" };
  }
  if (!toStr) {
    return { error: "to is required" };
  }

  const fromMatch = ISO_DATE.exec(fromStr);
  const toMatch = ISO_DATE.exec(toStr);

  if (!fromMatch || !toMatch) {
    return { error: "from and to must be YYYY-MM-DD" };
  }

  const fromYear = Number(fromMatch[1]);
  const fromMonth = Number(fromMatch[2]);
  const fromDay = Number(fromMatch[3]);
  const toYear = Number(toMatch[1]);
  const toMonth = Number(toMatch[2]);
  const toDay = Number(toMatch[3]);

  const from = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0));
  const to = new Date(Date.UTC(toYear, toMonth - 1, toDay, 23, 59, 59, 999));

  if (
    from.getUTCFullYear() !== fromYear ||
    from.getUTCMonth() !== fromMonth - 1 ||
    from.getUTCDate() !== fromDay
  ) {
    return { error: "from is not a valid calendar date" };
  }

  if (
    to.getUTCFullYear() !== toYear ||
    to.getUTCMonth() !== toMonth - 1 ||
    to.getUTCDate() !== toDay
  ) {
    return { error: "to is not a valid calendar date" };
  }

  if (from.getTime() > to.getTime()) {
    return { error: "from must be on or before to" };
  }

  return { from, to };
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

  const includeOfi = request.nextUrl.searchParams.get("include_ofi") === "true";

  try {
    const kpis = await getAllClosureKpis(period, prisma, includeOfi);

    return NextResponse.json({
      period,
      overall: kpis.overall,
      byAuditType: kpis.byAuditType,
      byAuditName: kpis.byAuditName,
      byFollowUpAuditor: kpis.byFollowUpAuditor,
      byDepartment: kpis.byDepartment,
      byTeamL1: kpis.byTeamL1,
      byEntity: kpis.byEntity,
      byPriority: kpis.byPriority,
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute closure KPIs" }, { status: 500 });
  }
}
