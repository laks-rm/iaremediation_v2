import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { nullableString } from "../../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const entityImportSchema = z.array(
  z.object({
    code: z.string().trim().min(1),
    entity_id: z.string().nullable().optional(),
    full_name: z.string().trim().min(1),
    country: z.string().nullable().optional(),
    group_category: z.string().nullable().optional(),
    display_order: z.coerce.number().int().optional().default(0),
    is_active: z.boolean().optional().default(true),
  }),
);

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const parsed = entityImportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    let created = 0;
    let updated = 0;
    for (const item of parsed.data) {
      const existing = await prisma.entities.findUnique({ where: { code: item.code } });
      await prisma.entities.upsert({
        where: { code: item.code },
        update: {
          entity_id: nullableString(item.entity_id),
          full_name: item.full_name,
          country: nullableString(item.country),
          group_category: nullableString(item.group_category),
          display_order: item.display_order,
          is_active: item.is_active,
        },
        create: {
          code: item.code,
          entity_id: nullableString(item.entity_id),
          full_name: item.full_name,
          country: nullableString(item.country),
          group_category: nullableString(item.group_category),
          display_order: item.display_order,
          is_active: item.is_active,
        },
      });
      if (existing) updated += 1;
      else created += 1;
    }

    return NextResponse.json({ summary: { processed: parsed.data.length, created, updated } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
