import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  canMutateOwnedActionPlan,
  getActionPlanForAccess,
  getClientIp,
  parseNullableDate,
  toAuditJson,
} from "../../../../../../lib/action-plans/access";
import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const reviseTargetSchema = z.object({
  new_target_date: z.string().min(1),
  justification: z.string().trim().min(1),
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

    const parsed = reviseTargetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const newDate = parseNullableDate(parsed.data.new_target_date);
    const before = await prisma.action_plans.findUnique({ where: { id } });
    const updated = await prisma.action_plans.update({
      where: { id },
      data: {
        current_target_date: newDate,
        reschedule_count: {
          increment: 1,
        },
      },
    });
    await prisma.target_date_revisions.create({
      data: {
        action_plan_id: id,
        old_date: before?.current_target_date ?? null,
        new_date: newDate,
        justification: parsed.data.justification,
        revised_by_id: currentUser.id,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "ActionPlan",
      entityId: id,
      beforeJson: toAuditJson(before),
      afterJson: toAuditJson(updated),
      ipAddress: getClientIp(request),
    });

    // Propagate current_target_date to mirrors if this is a primary plan
    if (before?.linked_primary_id === null || before?.linked_primary_id === undefined) {
      await prisma.action_plans.updateMany({
        where: { linked_primary_id: id, is_deleted: false },
        data: { current_target_date: newDate },
      });
    }

    return NextResponse.json({ action_plan: updated });
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
