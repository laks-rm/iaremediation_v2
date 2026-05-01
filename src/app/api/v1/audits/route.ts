import { AuditOpinionRating, AuditType, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../lib/auth/requireRole";
import { prisma } from "../../../../lib/db/prisma";

const createAuditSchema = z.object({
  name: z.string().trim().min(1).max(255),
  reference_number: z.string().trim().max(100).nullable().optional(),
  audit_type: z.enum(["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"]),
  opinion_rating: z
    .enum(["Satisfactory", "NeedsImprovement", "Unsatisfactory"])
    .nullable()
    .optional(),
  report_issue_date: z.string().trim().nullable().optional(),
  executive_summary: z.string().trim().nullable().optional(),
  entity_ids: z.array(z.string().uuid()).min(1),
});

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

function nullableString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseNullableDate(value: string | null | undefined) {
  const trimmed = nullableString(value);
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date");
  }

  return parsed;
}

function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const auditInclude = {
  audit_entities: {
    include: {
      entity: {
        select: {
          id: true,
          code: true,
          full_name: true,
        },
      },
    },
    orderBy: {
      entity: {
        code: "asc",
      },
    },
  },
} satisfies Prisma.auditsInclude;

export async function GET() {
  try {
    await requireRole(["AuditTeam", "Viewer"]);

    const audits = await prisma.audits.findMany({
      where: {
        is_deleted: false,
      },
      select: {
        id: true,
        name: true,
        reference_number: true,
        audit_type: true,
        opinion_rating: true,
        report_issue_date: true,
        created_at: true,
        audit_entities: {
          select: {
            entity: {
              select: {
                id: true,
                code: true,
                full_name: true,
              },
            },
          },
          orderBy: {
            entity: {
              code: "asc",
            },
          },
        },
        findings: {
          where: {
            is_deleted: false,
          },
          select: {
            id: true,
            action_plans: {
              where: {
                is_deleted: false,
              },
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return NextResponse.json({
      audits: audits.map((audit) => {
        const actionPlans = audit.findings.flatMap((finding) => finding.action_plans);
        const closedStatuses = new Set(["Closed", "Dropped", "RiskAccepted"]);

        return {
          ...audit,
          finding_count: audit.findings.length,
          action_plan_count: actionPlans.length,
          open_action_plan_count: actionPlans.filter(
            (actionPlan) => !closedStatuses.has(actionPlan.status),
          ).length,
          findings: undefined,
        };
      }),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const parsed = createAuditSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const entityIds = [...new Set(parsed.data.entity_ids)];
    const entityCount = await prisma.entities.count({
      where: {
        id: {
          in: entityIds,
        },
        is_active: true,
      },
    });

    if (entityCount !== entityIds.length) {
      return NextResponse.json({ error: "One or more entities are invalid" }, { status: 400 });
    }

    const audit = await prisma.$transaction(async (tx) => {
      return tx.audits.create({
        data: {
          name: parsed.data.name,
          reference_number: nullableString(parsed.data.reference_number),
          audit_type: parsed.data.audit_type as AuditType,
          opinion_rating: parsed.data.opinion_rating as AuditOpinionRating | null | undefined,
          report_issue_date: parseNullableDate(parsed.data.report_issue_date),
          executive_summary: nullableString(parsed.data.executive_summary),
          created_by_id: currentUser.id,
          audit_entities: {
            create: entityIds.map((entityId) => ({
              entity_id: entityId,
            })),
          },
        },
        include: auditInclude,
      });
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Create",
      entityType: "audits",
      entityId: audit.id,
      afterJson: toAuditJson(audit),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ audit }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Invalid date") {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
