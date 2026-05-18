import { ActionPlanStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  canMutateOwnedActionPlan,
  getActionPlanForAccess,
  getClientIp,
  nullableString,
  toAuditJson,
} from "../../../../../../lib/action-plans/access";
import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const statusSchema = z.object({
  new_status: z
    .enum(["NotStarted", "InProgress", "PendingValidation", "Closed", "RiskAccepted", "Dropped"])
    .optional(),
  status: z
    .enum(["NotStarted", "InProgress", "PendingValidation", "Closed", "RiskAccepted", "Dropped"])
    .optional(),
  remarks: z.string().nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMutateOwnedActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = statusSchema.safeParse(await request.json().catch(() => null));
    const newStatus = parsed.success ? parsed.data.new_status ?? parsed.data.status : undefined;

    if (!parsed.success || !newStatus) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const before = await prisma.action_plans.findUnique({ where: { id } });
    const updated = await prisma.action_plans.update({
      where: { id },
      data: {
        status: newStatus as ActionPlanStatus,
        closed_at: newStatus === "Closed" ? new Date() : null,
      },
    });
    await prisma.status_history.create({
      data: {
        action_plan_id: id,
        from_status: before?.status ?? null,
        to_status: newStatus as ActionPlanStatus,
        remarks: nullableString(parsed.data.remarks),
        changed_by_id: currentUser.id,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "StatusChange",
      entityType: "ActionPlan",
      entityId: id,
      beforeJson: toAuditJson(before),
      afterJson: toAuditJson(updated),
      ipAddress: getClientIp(request),
    });

    // Propagate status and closed_at to mirrors if this is a primary plan
    if (before?.linked_primary_id === null || before?.linked_primary_id === undefined) {
      await prisma.action_plans.updateMany({
        where: { linked_primary_id: id, is_deleted: false },
        data: {
          status: updated.status,
          closed_at: updated.closed_at,
        },
      });
    }

    return NextResponse.json({ action_plan: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
