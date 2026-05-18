import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    await requireRole(["AuditTeam"]);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const excludeId = searchParams.get("exclude_id") ?? "";

    const actionPlans = await prisma.action_plans.findMany({
      where: {
        is_deleted: false,
        linked_primary_id: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(q
          ? {
              OR: [
                { display_id: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                {
                  finding: {
                    audit: {
                      name: { contains: q, mode: "insensitive" },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        display_id: true,
        title: true,
        description: true,
        status: true,
        finding: {
          select: {
            audit: {
              select: {
                name: true,
              },
            },
          },
        },
        action_plan_entities: {
          select: {
            entity: {
              select: {
                code: true,
              },
            },
          },
          orderBy: {
            entity: {
              code: "asc",
            },
          },
        },
      },
      orderBy: {
        display_id: "desc",
      },
      take: 20,
    });

    return NextResponse.json({ action_plans: actionPlans });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
