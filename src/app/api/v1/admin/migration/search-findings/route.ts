import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const findings = await prisma.findings.findMany({
      where: q.length > 0
        ? {
            is_deleted: false,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              {
                audit: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
            ],
          }
        : { is_deleted: false },
      select: {
        id: true,
        title: true,
        audit_id: true,
        audit: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { audit: { name: "asc" } },
        { title: "asc" },
      ],
      take: 30,
    });

    return NextResponse.json({
      findings: findings.map((f) => ({
        id: f.id,
        title: f.title,
        audit_id: f.audit_id,
        audit_name: f.audit?.name ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
