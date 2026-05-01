import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const auditorSchema = z.object({
  user_id: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function ensureActionPlan(id: string) {
  return prisma.action_plans.findFirst({
    where: {
      id,
      is_deleted: false,
    },
    select: {
      id: true,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const parsed = auditorSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const [actionPlan, user] = await Promise.all([
      ensureActionPlan(id),
      prisma.users.findFirst({
        where: {
          id: parsed.data.user_id,
          is_active: true,
          is_internal_auditor: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (!actionPlan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!user) {
      return NextResponse.json({ error: "Follow-up auditor not found" }, { status: 404 });
    }

    const auditor = await prisma.action_plan_follow_up_auditors.create({
      data: {
        action_plan_id: id,
        user_id: parsed.data.user_id,
      },
      include: {
        user: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "ActionPlan",
      entityId: id,
      afterJson: {
        change: "follow_up_auditor_assigned",
        auditor_name: auditor.user.name,
        auditor_user_id: parsed.data.user_id,
      },
    });

    return NextResponse.json({ auditor }, { status: 201 });
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
    const userId = request.nextUrl.searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const auditor = await prisma.action_plan_follow_up_auditors.findFirst({
      where: {
        action_plan_id: id,
        user_id: userId,
      },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    const deleted = await prisma.action_plan_follow_up_auditors.deleteMany({
      where: {
        action_plan_id: id,
        user_id: userId,
      },
    });

    if (deleted.count > 0) {
      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "ActionPlan",
        entityId: id,
        afterJson: {
          change: "follow_up_auditor_removed",
          auditor_name: auditor?.user.name ?? "Unknown user",
          auditor_user_id: userId,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
