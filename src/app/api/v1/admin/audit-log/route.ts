import { NextRequest, NextResponse } from "next/server";

import {
  auditLogQueryFromSearchParams,
  buildAuditLogWhere,
  countAuditLogRows,
  getAuditLogPagination,
  getAuditLogRows,
  serializeAuditLogEntries,
} from "../../../../../lib/admin/audit-log";
import { AuthError, requireAdmin } from "../../../../../lib/auth/requireRole";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const query = auditLogQueryFromSearchParams(request.nextUrl.searchParams);
    const where = buildAuditLogWhere(query);
    const pagination = getAuditLogPagination(query);
    const [entries, total] = await Promise.all([
      getAuditLogRows(where, pagination.pageSize, pagination.skip),
      countAuditLogRows(where),
    ]);

    return NextResponse.json({
      entries: await serializeAuditLogEntries(entries),
      total,
      page: pagination.page,
      page_size: pagination.pageSize,
      page_was_capped: pagination.pageWasCapped,
      result_set_is_large: total > pagination.pageSize * 200,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
