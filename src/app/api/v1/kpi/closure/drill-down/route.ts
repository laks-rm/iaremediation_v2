import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../../lib/db/prisma";
import {
  ClosureDimension,
  ClosurePeriod,
  getClosureKpiDrillDown,
} from "../../../../../../lib/kpi/closure";

const CLOSURE_DIMENSIONS: ClosureDimension[] = [
  "audit_type",
  "audit_name",
  "follow_up_auditor",
  "department",
];

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

function parseDimension(value: string | null): ClosureDimension | null {
  return value && CLOSURE_DIMENSIONS.includes(value as ClosureDimension)
    ? (value as ClosureDimension)
    : null;
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dimension = parseDimension(request.nextUrl.searchParams.get("dimension"));
  const dimensionValue = request.nextUrl.searchParams.get("dimension_value");
  const period = parsePeriod(request.nextUrl.searchParams);

  if (!dimension) {
    return NextResponse.json({ error: "dimension is required" }, { status: 400 });
  }
  if (!dimensionValue) {
    return NextResponse.json({ error: "dimension_value is required" }, { status: 400 });
  }
  if ("error" in period) {
    return NextResponse.json({ error: period.error }, { status: 400 });
  }

  try {
    const { dueIds, closedIds } = await getClosureKpiDrillDown(dimension, dimensionValue, period, prisma);

    return NextResponse.json({
      dimension,
      dimensionValue,
      period,
      dueIds,
      closedIds,
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute drill-down" }, { status: 500 });
  }
}
