import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const multiEntityOnly = searchParams.get("multi_entity_only") === "true";

    const where = q.length > 0
      ? {
          is_deleted: false,
          OR: [
            { display_id: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            {
              finding: {
                title: { contains: q, mode: "insensitive" as const },
              },
            },
            {
              finding: {
                audit: {
                  name: { contains: q, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : { is_deleted: false };

    const aps = await prisma.action_plans.findMany({
      where,
      select: {
        id: true,
        display_id: true,
        title: true,
        description: true,
        status: true,
        finding: {
          select: {
            id: true,
            title: true,
            audit: {
              select: {
                id: true,
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
        },
      },
      orderBy: { display_id: "desc" },
      take: multiEntityOnly ? 100 : 30,
    });

    const filtered = multiEntityOnly
      ? aps.filter((ap) => ap.action_plan_entities.length > 1).slice(0, 30)
      : aps;

    return NextResponse.json({ action_plans: filtered });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
