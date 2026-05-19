import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const rehomeSchema = z.object({
  action_plan_id: z.string().uuid(),
  target_finding_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireAdmin();

    const body = rehomeSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { action_plan_id, target_finding_id } = body.data;

    const ap = await prisma.action_plans.findFirst({
      where: { id: action_plan_id, is_deleted: false },
      select: {
        id: true,
        display_id: true,
        finding_id: true,
        finding: {
          select: {
            id: true,
            title: true,
            audit_id: true,
            audit: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!ap) {
      return NextResponse.json({ error: "Action plan not found" }, { status: 404 });
    }

    if (ap.finding_id === target_finding_id) {
      return NextResponse.json({ error: "Action plan is already on this finding" }, { status: 400 });
    }

    const targetFinding = await prisma.findings.findFirst({
      where: { id: target_finding_id, is_deleted: false },
      select: {
        id: true,
        title: true,
        audit_id: true,
        audit: { select: { id: true, name: true } },
      },
    });

    if (!targetFinding) {
      return NextResponse.json({ error: "Target finding not found" }, { status: 404 });
    }

    await prisma.action_plans.update({
      where: { id: action_plan_id },
      data: {
        finding_id: target_finding_id,
        updated_at: new Date(),
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "action_plan",
      entityId: action_plan_id,
      beforeJson: {
        finding_id: ap.finding_id,
        finding_title: ap.finding?.title ?? null,
        audit_id: ap.finding?.audit_id ?? null,
        audit_name: ap.finding?.audit?.name ?? null,
      },
      afterJson: {
        finding_id: target_finding_id,
        finding_title: targetFinding.title,
        audit_id: targetFinding.audit_id,
        audit_name: targetFinding.audit?.name ?? null,
        migration_op: "rehome",
      },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? request.headers.get("x-real-ip"),
    });

    return NextResponse.json({ ok: true, display_id: ap.display_id });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
