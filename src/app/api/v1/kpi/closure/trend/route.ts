import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../../lib/db/prisma";
import { fetchActionPlans, getClosureKpiTrend } from "../../../../../../lib/kpi/closure";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type TrendBucketKind = "month" | "week";

function parseIsoDateParam(value: string | null, name: string): { error: string } | { y: number; m: number; d: number } {
  if (!value) {
    return { error: `${name} is required` };
  }

  const m = ISO_DATE.exec(value);
  if (!m) {
    return { error: `${name} must be YYYY-MM-DD` };
  }

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const time = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    return { error: `${name} is not a valid calendar date` };
  }

  return { y, m: mo - 1, d };
}

function parseTrendRange(
  searchParams: URLSearchParams,
): { from: Date; to: Date } | { error: string } {
  const fromParsed = parseIsoDateParam(searchParams.get("trend_from"), "trend_from");
  if ("error" in fromParsed) {
    return fromParsed;
  }
  const toParsed = parseIsoDateParam(searchParams.get("trend_to"), "trend_to");
  if ("error" in toParsed) {
    return toParsed;
  }

  const from = new Date(Date.UTC(fromParsed.y, fromParsed.m, fromParsed.d, 0, 0, 0, 0));
  const to = new Date(Date.UTC(toParsed.y, toParsed.m, toParsed.d, 23, 59, 59, 999));

  if (from.getTime() > to.getTime()) {
    return { error: "trend_from must be on or before trend_to" };
  }

  return { from, to };
}

function parseBucketKind(
  searchParams: URLSearchParams,
): { kind: TrendBucketKind } | { error: string } {
  const raw = searchParams.get("bucket") ?? "month";
  if (raw === "month" || raw === "week") {
    return { kind: raw };
  }
  return { error: 'bucket must be "month" or "week"' };
}

/** Monday 00:00:00.000 UTC for the ISO week containing the given UTC calendar day. */
function utcMondayStartForCalendarDay(y: number, m0: number, d: number): Date {
  const noon = Date.UTC(y, m0, d, 12, 0, 0, 0);
  const day = new Date(noon);
  const dow = day.getUTCDay(); // 0 Sun .. 6 Sat
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  const monMs = noon + deltaToMonday * 86_400_000;
  const mon = new Date(monMs);
  return new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 0, 0, 0, 0));
}

/** End of Sunday (23:59:59.999 UTC) for the ISO week that starts on `mondayStart`. */
function utcSundayEndForWeekMonday(mondayStart: Date): Date {
  const y = mondayStart.getUTCFullYear();
  const m = mondayStart.getUTCMonth();
  const d = mondayStart.getUTCDate();
  return new Date(Date.UTC(y, m, d + 6, 23, 59, 59, 999));
}

/** ISO week number for the week containing this UTC calendar day (same week as Monday `monday`). */
function isoWeekNumberUtc(y: number, m0: number, d: number): number {
  const t = new Date(Date.UTC(y, m0, d, 12, 0, 0, 0));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const isoYear = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0, 0));
  const w1 = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000;
  return Math.floor((t.getTime() - w1) / (7 * 86_400_000)) + 1;
}

function formatWeekLabel(monday: Date): string {
  const y = monday.getUTCFullYear();
  const m0 = monday.getUTCMonth();
  const d = monday.getUTCDate();
  const w = isoWeekNumberUtc(y, m0, d);
  const monStr = `${d} ${MONTH_NAMES[m0]}`;
  return `W${w} · ${monStr}`;
}

/**
 * Build bucket periods within [trendFrom, trendTo] inclusive, using only Date.UTC for construction.
 * trendFrom / trendTo are the clamped overall window (start of first day .. end of last day UTC).
 */
export function generateBuckets(
  trendFrom: Date,
  trendTo: Date,
  kind: TrendBucketKind,
): Array<{ period_label: string; from: Date; to: Date }> {
  const rangeStart = trendFrom;
  const rangeEnd = trendTo;

  if (kind === "month") {
    const out: Array<{ period_label: string; from: Date; to: Date }> = [];
    let y = rangeStart.getUTCFullYear();
    let m = rangeStart.getUTCMonth();
    const endY = rangeEnd.getUTCFullYear();
    const endM = rangeEnd.getUTCMonth();

    while (y < endY || (y === endY && m <= endM)) {
      const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      const from = rangeStart.getTime() > monthStart.getTime() ? rangeStart : monthStart;
      const to = rangeEnd.getTime() < monthEnd.getTime() ? rangeEnd : monthEnd;
      if (from.getTime() <= to.getTime()) {
        out.push({
          period_label: `${MONTH_NAMES[m]} ${y}`,
          from,
          to,
        });
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }

  const out: Array<{ period_label: string; from: Date; to: Date }> = [];
  const startY = rangeStart.getUTCFullYear();
  const startM = rangeStart.getUTCMonth();
  const startD = rangeStart.getUTCDate();
  let weekMonday = utcMondayStartForCalendarDay(startY, startM, startD);

  while (weekMonday.getTime() <= rangeEnd.getTime()) {
    const sundayEnd = utcSundayEndForWeekMonday(weekMonday);
    const from = rangeStart.getTime() > weekMonday.getTime() ? rangeStart : weekMonday;
    const to = rangeEnd.getTime() < sundayEnd.getTime() ? rangeEnd : sundayEnd;
    if (from.getTime() <= to.getTime()) {
      out.push({
        period_label: formatWeekLabel(weekMonday),
        from,
        to,
      });
    }
    const ny = weekMonday.getUTCFullYear();
    const nm = weekMonday.getUTCMonth();
    const nd = weekMonday.getUTCDate();
    const nextMonday = new Date(Date.UTC(ny, nm, nd + 7, 0, 0, 0, 0));
    weekMonday = nextMonday;
  }

  return out;
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bucketParsed = parseBucketKind(request.nextUrl.searchParams);
  if ("error" in bucketParsed) {
    return NextResponse.json({ error: bucketParsed.error }, { status: 400 });
  }

  const range = parseTrendRange(request.nextUrl.searchParams);
  if ("error" in range) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  const trendFrom = range.from;
  const trendTo = range.to;
  const bucketPeriods = generateBuckets(trendFrom, trendTo, bucketParsed.kind);
  const includeOfi = request.nextUrl.searchParams.get("include_ofi") === "true";

  try {
    const actionPlans = await fetchActionPlans({ from: trendFrom, to: trendTo }, prisma, includeOfi);
    const trendRows = getClosureKpiTrend(actionPlans, bucketPeriods);

    const buckets = trendRows.map((row) => ({
      period_label: row.period_label,
      from: row.from,
      to: row.to,
      due_in_period: row.due_in_period,
      overdue_brought_forward: row.overdue_brought_forward,
      due: row.due,
      closed: row.closed,
      closure_rate: row.closure_rate,
      overdue_at_period_end: row.overdue_at_period_end,
      overdue_created_in_period: row.overdue_created_in_period,
      net_movement: row.net_movement,
    }));

    return NextResponse.json({
      trend_from: trendFrom,
      trend_to: trendTo,
      bucket: bucketParsed.kind,
      buckets,
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute closure trend" }, { status: 500 });
  }
}
