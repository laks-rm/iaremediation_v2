import { Priority, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import {
  canViewActionPlan,
  getActionPlanForAccess,
  getActionPlanPayload,
  getClientIp,
  nullableString,
  toAuditJson,
} from "../../../../../lib/action-plans/access";

const updateSchema = z.object({
  description: z.string().min(1).optional(),
  required_evidence: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  closure_remarks: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canViewActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await getActionPlanPayload(id);
    return NextResponse.json(payload);
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
    const existing = await prisma.action_plans.findFirst({
      where: { id, is_deleted: false },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const data: Prisma.action_plansUpdateInput = {};
    let validatedClosedAt: Date | null | undefined;

    if (parsed.data.description !== undefined) {
      data.description = parsed.data.description;
    }
    if (parsed.data.required_evidence !== undefined) {
      data.required_evidence = nullableString(parsed.data.required_evidence);
    }
    if (parsed.data.department !== undefined) {
      data.department = nullableString(parsed.data.department);
    }
    if (parsed.data.closure_remarks !== undefined) {
      data.closure_remarks = nullableString(parsed.data.closure_remarks);
    }
    if (parsed.data.closed_at !== undefined) {
      if (parsed.data.closed_at === null) {
        validatedClosedAt = null;
      } else {
        const parsedClosedAt = new Date(parsed.data.closed_at);
        if (Number.isNaN(parsedClosedAt.getTime()) || parsedClosedAt > new Date()) {
          return NextResponse.json(
            { error: "closed_at must be a valid date and cannot be in the future" },
            { status: 400 },
          );
        }
        validatedClosedAt = parsedClosedAt;
      }
      data.closed_at = validatedClosedAt;
    }
    if (parsed.data.priority !== undefined) {
      data.priority = parsed.data.priority as Priority | null;
    }
    const updated = await prisma.action_plans.update({
      where: { id },
      data,
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "ActionPlan",
      entityId: id,
      beforeJson:
        parsed.data.closed_at !== undefined
          ? toAuditJson({ closed_at: existing.closed_at })
          : toAuditJson(existing),
      afterJson:
        parsed.data.closed_at !== undefined
          ? toAuditJson({ closed_at: updated.closed_at })
          : toAuditJson(updated),
      ipAddress: getClientIp(request),
    });

    const payload = await getActionPlanPayload(id);
    return NextResponse.json(payload);
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
    const existing = await prisma.action_plans.findFirst({
      where: { id, is_deleted: false },
      select: {
        id: true,
        display_id: true,
        description: true,
        status: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.action_plans.update({
      where: { id },
      data: {
        is_deleted: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "ActionPlan",
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
