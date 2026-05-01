import { NextRequest, NextResponse } from "next/server";

import {
  canViewActionPlan,
  getActionPlanForAccess,
  safeUserSelect,
} from "../../../../../../lib/action-plans/access";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canViewActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const entries = await prisma.audit_log.findMany({
      where: {
        entity_type: "ActionPlan",
        entity_id: id,
      },
      include: {
        user: {
          select: safeUserSelect,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return NextResponse.json({ audit_log: entries });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
