import { NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../lib/auth/requireRole";
import { prisma } from "../../../../lib/db/prisma";

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const entities = await prisma.entities.findMany({
      select: {
        id: true,
        code: true,
        full_name: true,
        is_active: true,
      },
      orderBy: [{ display_order: "asc" }, { code: "asc" }],
    });
    return NextResponse.json({ entities });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
