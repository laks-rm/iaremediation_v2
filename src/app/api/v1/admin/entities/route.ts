import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { nullableString } from "../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const entitySchema = z.object({
  code: z.string().trim().min(1),
  entity_id: z.string().nullable().optional(),
  full_name: z.string().trim().min(1),
  country: z.string().nullable().optional(),
  group_category: z.string().nullable().optional(),
  display_order: z.number().int().optional().default(0),
  is_active: z.boolean().optional().default(true),
});

export async function GET() {
  try {
    await requireAdmin();
    const entities = await prisma.entities.findMany({
      orderBy: [{ display_order: "asc" }, { code: "asc" }],
    });
    return NextResponse.json({ entities });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const parsed = entitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const entity = await prisma.entities.create({
      data: {
        code: parsed.data.code,
        entity_id: nullableString(parsed.data.entity_id),
        full_name: parsed.data.full_name,
        country: nullableString(parsed.data.country),
        group_category: nullableString(parsed.data.group_category),
        display_order: parsed.data.display_order,
        is_active: parsed.data.is_active,
      },
    });
    return NextResponse.json({ entity }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
