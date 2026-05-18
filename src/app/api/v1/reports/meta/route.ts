import { NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer", "Auditee"]);

    const departments = await prisma.action_plans.findMany({
      where: { is_deleted: false, department: { not: null } },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    });

    return NextResponse.json({
      departments: departments.map((d) => d.department).filter(Boolean) as string[],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
