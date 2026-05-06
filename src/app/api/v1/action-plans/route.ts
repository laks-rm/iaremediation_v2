import crypto from "crypto";
import { CreatedVia, Prisma, Priority } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../lib/auth/requireRole";
import { prisma } from "../../../../lib/db/prisma";

const createActionPlanSchema = z.object({
  finding_id: z.string().uuid(),
  description: z.string().trim().min(1),
  priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
  original_target_date: z.string().trim().nullable().optional(),
  current_target_date: z.string().trim().nullable().optional(),
  required_evidence: z.string().trim().nullable().optional(),
  department: z.string().trim().max(255).nullable().optional(),
  entity_ids: z.array(z.string().uuid()).optional().default([]),
  owner_user_id: z.string().uuid().nullable().optional(),
  follow_up_auditor_user_id: z.string().uuid().nullable().optional(),
  created_via: z.enum(["Manual", "Standalone"]).optional().default("Manual"),
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

async function getUniqueDisplayId(auditReportIssueYear?: number) {
  const year = auditReportIssueYear ?? new Date().getFullYear();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const displayId = `AP-${year}-${suffix}`;
    const existing = await prisma.action_plans.findUnique({
      where: {
        display_id: displayId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return displayId;
    }
  }

  throw new Error("Unable to generate display id");
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const parsed = createActionPlanSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const finding = await prisma.findings.findFirst({
      where: {
        id: parsed.data.finding_id,
        is_deleted: false,
      },
      select: {
        id: true,
        audit: {
          select: {
            report_issue_date: true,
          },
        },
      },
    });

    if (!finding) {
      return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    }

    const auditReportIssueYear = finding.audit?.report_issue_date
      ? finding.audit.report_issue_date.getFullYear()
      : undefined;

    const entityIds = [...new Set(parsed.data.entity_ids)];
    if (entityIds.length > 0) {
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
    }

    if (parsed.data.owner_user_id) {
      const owner = await prisma.users.findFirst({
        where: {
          id: parsed.data.owner_user_id,
          is_active: true,
        },
        select: {
          id: true,
        },
      });

      if (!owner) {
        return NextResponse.json({ error: "Owner not found" }, { status: 404 });
      }
    }

    if (parsed.data.follow_up_auditor_user_id) {
      const followUpAuditor = await prisma.users.findFirst({
        where: {
          id: parsed.data.follow_up_auditor_user_id,
          is_active: true,
          is_internal_auditor: true,
        },
        select: {
          id: true,
        },
      });

      if (!followUpAuditor) {
        return NextResponse.json({ error: "Follow-up auditor not found" }, { status: 404 });
      }
    }

    const displayId = await getUniqueDisplayId(auditReportIssueYear);
    const actionPlan = await prisma.$transaction(async (tx) => {
      return tx.action_plans.create({
        data: {
          display_id: displayId,
          finding_id: parsed.data.finding_id,
          description: parsed.data.description,
          priority: parsed.data.priority as Priority | null | undefined,
          original_target_date: parseNullableDate(parsed.data.original_target_date),
          current_target_date: parseNullableDate(parsed.data.current_target_date),
          required_evidence: nullableString(parsed.data.required_evidence),
          department: nullableString(parsed.data.department),
          created_via: parsed.data.created_via as CreatedVia,
          created_by_id: currentUser.id,
          action_plan_entities:
            entityIds.length > 0
              ? {
                  create: entityIds.map((entityId) => ({
                    entity_id: entityId,
                  })),
                }
              : undefined,
          action_plan_owners: parsed.data.owner_user_id
            ? {
                create: {
                  user_id: parsed.data.owner_user_id,
                  is_primary: true,
                  assigned_by_id: currentUser.id,
                },
              }
            : undefined,
          action_plan_follow_up_auditors: parsed.data.follow_up_auditor_user_id
            ? {
                create: {
                  user_id: parsed.data.follow_up_auditor_user_id,
                },
              }
            : undefined,
        },
        include: {
          action_plan_entities: true,
          action_plan_owners: true,
          action_plan_follow_up_auditors: true,
        },
      });
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Create",
      entityType: "action_plans",
      entityId: actionPlan.id,
      afterJson: toAuditJson(actionPlan),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ action_plan: actionPlan }, { status: 201 });
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
