import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const updateSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  mark_all_read: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const [notifications, count] = await Promise.all([
      prisma.user_import_notifications.findMany({
        where: { is_read: false },
        orderBy: { created_at: "desc" },
        take: 100,
      }),
      prisma.user_import_notifications.count({ where: { is_read: false } }),
    ]);
    return NextResponse.json({ notifications, count });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    await prisma.user_import_notifications.updateMany({
      where: parsed.data.mark_all_read ? { is_read: false } : { id: { in: parsed.data.ids ?? [] } },
      data: { is_read: true },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
