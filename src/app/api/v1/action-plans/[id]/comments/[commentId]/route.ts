import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
    commentId: string;
  }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const { id, commentId } = await context.params;
    const comment = await prisma.comments.findFirst({
      where: {
        id: commentId,
        action_plan_id: id,
        is_deleted: false,
      },
    });

    if (!comment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (currentUser.role !== "AuditTeam" && comment.user_id !== currentUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.comments.update({
      where: {
        id: commentId,
      },
      data: {
        is_deleted: true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
