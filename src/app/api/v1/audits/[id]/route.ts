import { AuditOpinionRating, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const updateAuditSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  reference_number: z.string().trim().max(100).nullable().optional(),
  opinion_rating: z
    .enum(["Satisfactory", "NeedsImprovement", "Unsatisfactory"])
    .nullable()
    .optional(),
  executive_summary: z.string().trim().nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

function nullableString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function getAudit(id: string) {
  const audit = await prisma.audits.findFirst({
    where: {
      id,
      is_deleted: false,
    },
    include: {
      created_by: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      audit_entities: {
        include: {
          entity: true,
        },
        orderBy: {
          entity: {
            code: "asc",
          },
        },
      },
      control_areas: {
        orderBy: {
          display_order: "asc",
        },
      },
      findings: {
        where: {
          is_deleted: false,
        },
        orderBy: [
          {
            display_order: "asc",
          },
          {
            created_at: "asc",
          },
        ],
        include: {
          action_plans: {
            where: {
              is_deleted: false,
            },
            orderBy: {
              created_at: "asc",
            },
            include: {
              action_plan_owners: {
                where: {
                  is_primary: true,
                },
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      department: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!audit) {
    return null;
  }

  return {
    ...audit,
    findings: audit.findings.map((finding) => ({
      ...finding,
      action_plan_count: finding.action_plans.length,
    })),
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["AuditTeam", "Viewer"]);
    const { id } = await context.params;
    const audit = await getAudit(id);

    if (!audit) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ audit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const parsed = updateAuditSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await prisma.audits.findFirst({
      where: {
        id,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Prisma.auditsUpdateInput = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name;
    }
    if (parsed.data.reference_number !== undefined) {
      data.reference_number = nullableString(parsed.data.reference_number);
    }
    if (parsed.data.opinion_rating !== undefined) {
      data.opinion_rating = parsed.data.opinion_rating as AuditOpinionRating | null;
    }
    if (parsed.data.executive_summary !== undefined) {
      data.executive_summary = nullableString(parsed.data.executive_summary);
    }

    const updated = await prisma.audits.update({
      where: {
        id,
      },
      data,
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "audits",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(updated),
      ipAddress: getClientIp(request),
    });

    const audit = await getAudit(id);
    return NextResponse.json({ audit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const existing = await prisma.audits.findFirst({
      where: {
        id,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.audits.update({
      where: {
        id,
      },
      data: {
        is_deleted: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "audits",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(updated),
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
