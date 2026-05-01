import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { nullableString } from "../../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const updateEntitySchema = z.object({
  entity_id: z.string().nullable().optional(),
  full_name: z.string().trim().min(1).optional(),
  country: z.string().nullable().optional(),
  group_category: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const parsed = updateEntitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const entity = await prisma.entities.update({
      where: { id },
      data: {
        ...("entity_id" in parsed.data ? { entity_id: nullableString(parsed.data.entity_id) } : {}),
        ...("full_name" in parsed.data ? { full_name: parsed.data.full_name } : {}),
        ...("country" in parsed.data ? { country: nullableString(parsed.data.country) } : {}),
        ...("group_category" in parsed.data ? { group_category: nullableString(parsed.data.group_category) } : {}),
        ...("display_order" in parsed.data ? { display_order: parsed.data.display_order } : {}),
        ...("is_active" in parsed.data ? { is_active: parsed.data.is_active } : {}),
      },
    });
    return NextResponse.json({ entity });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
