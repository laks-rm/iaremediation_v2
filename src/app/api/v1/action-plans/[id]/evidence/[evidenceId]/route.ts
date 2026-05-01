import { NextRequest, NextResponse } from "next/server";

import { getClientIp, toAuditJson } from "../../../../../../../lib/action-plans/access";
import { writeAuditLog } from "../../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    evidenceId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id, evidenceId } = await context.params;
    const existing = await prisma.evidence.findFirst({
      where: {
        id: evidenceId,
        action_plan_id: id,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const evidence = await prisma.evidence.update({
      where: {
        id: evidenceId,
      },
      data: {
        is_deleted: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "Evidence",
      entityId: evidenceId,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(evidence),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
