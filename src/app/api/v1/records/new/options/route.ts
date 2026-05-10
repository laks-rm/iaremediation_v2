import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    await requireRole(["AuditTeam"]);

    const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";

    const [entities, users] = await Promise.all([
      prisma.entities.findMany({
        where: {
          is_active: true,
        },
        select: {
          id: true,
          code: true,
          full_name: true,
        },
        orderBy: [
          {
            display_order: "asc",
          },
          {
            code: "asc",
          },
        ],
      }),
      prisma.users.findMany({
        where: includeInactive ? {} : {
          is_active: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          department: true,
          job_title: true,
          team_l2: true,
          is_internal_auditor: true,
          is_active: true,
        },
        orderBy: [
          {
            is_active: "desc",
          },
          {
            name: "asc",
          },
        ],
      }),
    ]);

    return NextResponse.json({
      entities,
      users,
      follow_up_auditors: users.filter((user) => user.is_internal_auditor),
      finding_types: ["Finding", "OpportunityForImprovement"],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
