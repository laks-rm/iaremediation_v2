import { NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const AUTHENTICATED_ROLES = ["AuditTeam", "Viewer", "Auditee", "Pending"];

export async function GET() {
  try {
    await requireRole(AUTHENTICATED_ROLES);

    const snapshot = await prisma.ai_insights_snapshot.findFirst({
      orderBy: {
        generated_at: "desc",
      },
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
