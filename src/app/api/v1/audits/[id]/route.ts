import { AuditOpinionRating, AuditType, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { fileExists } from "../../../../../lib/storage";

const updateAuditSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  reference_number: z.string().trim().max(100).nullable().optional(),
  audit_type: z.enum(["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"]).optional(),
  opinion_rating: z
    .enum(["Satisfactory", "NeedsImprovement", "Unsatisfactory"])
    .nullable()
    .optional(),
  executive_summary: z.string().trim().nullable().optional(),
  entity_ids: z.array(z.string().uuid()).optional(),
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

    let report_file_missing = false;
    if (audit.report_pdf_path) {
      report_file_missing = !(await fileExists(audit.report_pdf_path));
    }

    return NextResponse.json({ audit: { ...audit, report_file_missing } });
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
      include: {
        audit_entities: {
          select: {
            entity_id: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Validate entity_ids if provided
    if (parsed.data.entity_ids !== undefined) {
      const validEntities = await prisma.entities.findMany({
        where: {
          id: {
            in: parsed.data.entity_ids,
          },
        },
        select: {
          id: true,
        },
      });

      if (validEntities.length !== parsed.data.entity_ids.length) {
        return NextResponse.json(
          { error: "One or more entity IDs are invalid" },
          { status: 400 },
        );
      }
    }

    const data: Prisma.auditsUpdateInput = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name;
    }
    if (parsed.data.reference_number !== undefined) {
      data.reference_number = nullableString(parsed.data.reference_number);
    }
    if (parsed.data.audit_type !== undefined) {
      data.audit_type = parsed.data.audit_type as AuditType;
    }
    if (parsed.data.opinion_rating !== undefined) {
      data.opinion_rating = parsed.data.opinion_rating as AuditOpinionRating | null;
    }
    if (parsed.data.executive_summary !== undefined) {
      data.executive_summary = nullableString(parsed.data.executive_summary);
    }

    // Handle entity updates in transaction
    if (parsed.data.entity_ids !== undefined) {
      const oldEntityIds = existing.audit_entities.map((ae) => ae.entity_id);
      
      await prisma.$transaction([
        // Update audit fields
        prisma.audits.update({
          where: {
            id,
          },
          data,
        }),
        // Delete existing entity associations
        prisma.audit_entities.deleteMany({
          where: {
            audit_id: id,
          },
        }),
        // Insert new entity associations
        ...(parsed.data.entity_ids.length > 0
          ? [
              prisma.audit_entities.createMany({
                data: parsed.data.entity_ids.map((entity_id) => ({
                  audit_id: id,
                  entity_id,
                })),
              }),
            ]
          : []),
      ]);

      const updated = await prisma.audits.findFirst({
        where: { id },
      });

      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "audits",
        entityId: id,
        beforeJson: toAuditJson({ entity_ids: oldEntityIds }),
        afterJson: toAuditJson({ entity_ids: parsed.data.entity_ids }),
        ipAddress: getClientIp(request),
      });
    } else {
      // No entity changes, just update audit fields
      const updated = await prisma.audits.update({
        where: {
          id,
        },
        data,
      });

      if (Object.keys(data).length > 0) {
        await writeAuditLog({
          userId: currentUser.id,
          action: "Update",
          entityType: "audits",
          entityId: id,
          beforeJson: toAuditJson(existing),
          afterJson: toAuditJson(updated),
          ipAddress: getClientIp(request),
        });
      }
    }

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
    if (!currentUser.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await context.params;
    const existing = await prisma.audits.findFirst({
      where: {
        id,
        is_deleted: false,
      },
      include: {
        findings: {
          where: { is_deleted: false },
          select: {
            id: true,
            action_plans: {
              where: { is_deleted: false },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const findingIds = existing.findings.map((f) => f.id);
    const actionPlanCount = existing.findings.reduce((sum, f) => sum + f.action_plans.length, 0);

    // Soft delete the audit, all findings, and all action plans
    await prisma.$transaction([
      prisma.action_plans.updateMany({
        where: {
          finding_id: { in: findingIds },
          is_deleted: false,
        },
        data: {
          is_deleted: true,
        },
      }),
      prisma.findings.updateMany({
        where: {
          audit_id: id,
          is_deleted: false,
        },
        data: {
          is_deleted: true,
        },
      }),
      prisma.audits.update({
        where: { id },
        data: {
          is_deleted: true,
        },
      }),
    ]);

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "audits",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson({ ...existing, is_deleted: true }),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      findings_deleted: existing.findings.length,
      action_plans_deleted: actionPlanCount,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
