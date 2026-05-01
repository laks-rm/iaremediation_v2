import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireAdmin } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";

type RouteContext = { params: Promise<{ id: string }> };

const userIdSchema = z.string().uuid();

export async function POST(_request: Request, context: RouteContext) {
  try {
    const currentUser = await requireAdmin();
    const { id } = await context.params;
    const parsedUserId = userIdSchema.safeParse(id);

    if (!parsedUserId.success) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = await prisma.users.findUnique({
      where: { id: parsedUserId.data },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await prisma.users.update({
      where: { id: user.id },
      data: {
        password_must_change: true,
        failed_login_attempts: 0,
        locked_until: null,
      },
      select: { id: true },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "PasswordReset",
      entityType: "User",
      entityId: user.id,
      afterJson: {
        password_must_change: true,
        reset_by: currentUser.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "User will be prompted to set a new password on next login",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
