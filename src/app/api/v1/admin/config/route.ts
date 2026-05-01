import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireAdmin } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const configSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
});

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const key = request.nextUrl.searchParams.get("key");
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
    const config = await prisma.system_config.findUnique({ where: { key } });
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const parsed = configSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const config = await prisma.system_config.upsert({
      where: { key: parsed.data.key },
      update: { value: toJson(parsed.data.value), updated_by: admin.id },
      create: { key: parsed.data.key, value: toJson(parsed.data.value), updated_by: admin.id },
    });
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
