import { NextRequest, NextResponse } from "next/server";

import {
  MAX_EXPORT_ROWS,
  auditLogQueryFromSearchParams,
  buildAuditLogWhere,
  countAuditLogRows,
  getAuditLogChangeSummary,
  getAuditLogRows,
  serializeAuditLogEntries,
} from "../../../../../../lib/admin/audit-log";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";

function csvCell(value: unknown) {
  const text =
    typeof value === "string"
      ? value
      : value === null || value === undefined
        ? ""
        : JSON.stringify(value);

  return `"${text.replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const query = auditLogQueryFromSearchParams(request.nextUrl.searchParams);
    const where = buildAuditLogWhere(query);
    const total = await countAuditLogRows(where);

    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        { error: "This export is larger than 10,000 rows. Add more filters to narrow it down." },
        { status: 400 },
      );
    }

    const entries = await getAuditLogRows(where, MAX_EXPORT_ROWS);
    const serialized = await serializeAuditLogEntries(entries);
    const header = [
      "timestamp_utc",
      "user_name",
      "user_email",
      "ip_address",
      "action",
      "entity_type",
      "entity_id",
      "change_summary",
      "before_json",
      "after_json",
      "user_agent",
    ];
    const rows = serialized.map((entry) => {
      const summary = getAuditLogChangeSummary(entry);
      return [
        entry.created_at,
        entry.user?.name ?? "Unknown",
        entry.user?.email ?? "",
        entry.ip_address ?? "",
        entry.action,
        entry.entity_type,
        entry.entity_id ?? "",
        summary.detail ? `${summary.title} ${summary.detail}` : summary.title,
        entry.before_json,
        entry.after_json,
        entry.user_agent ?? "",
      ].map(csvCell).join(",");
    });
    const csv = [header.map(csvCell).join(","), ...rows].join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
