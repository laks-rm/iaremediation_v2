import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const ownerSchema = z.object({
  user_id: z.string().uuid(),
  is_primary: z.boolean().optional().default(false),
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
    const parsed = ownerSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const [actionPlan, user] = await Promise.all([
      ensureActionPlan(id),
      prisma.users.findFirst({
        where: {
          id: parsed.data.user_id,
          is_active: true,
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
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (parsed.data.is_primary) {
      await prisma.action_plan_owners.updateMany({
        where: {
          action_plan_id: id,
          is_primary: true,
        },
        data: {
          is_primary: false,
        },
      });
    }

    const owner = await prisma.action_plan_owners.create({
      data: {
        action_plan_id: id,
        user_id: parsed.data.user_id,
        is_primary: parsed.data.is_primary,
        assigned_by_id: currentUser.id,
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
        change: "owner_assigned",
        owner_name: owner.user.name,
        owner_user_id: parsed.data.user_id,
        is_primary: parsed.data.is_primary,
      },
    });

    return NextResponse.json({ owner }, { status: 201 });
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

    const owner = await prisma.action_plan_owners.findFirst({
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

    const deleted = await prisma.action_plan_owners.deleteMany({
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
          change: "owner_removed",
          owner_name: owner?.user.name ?? "Unknown user",
          owner_user_id: userId,
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
