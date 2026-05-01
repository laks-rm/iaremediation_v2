import { Prisma, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { nullableString, parseNullableDate, userSelect } from "../../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  role: z.enum(["AuditTeam", "Viewer", "Auditee", "Pending"]).optional(),
  is_internal_auditor: z.boolean().optional(),
  is_admin: z.boolean().optional(),
  is_active: z.boolean().optional(),
  employee_id: z.string().nullable().optional(),
  job_title: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  team_l1: z.string().nullable().optional(),
  team_l2: z.string().nullable().optional(),
  team_l3: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  manager_name: z.string().nullable().optional(),
  manager_email: z.string().nullable().optional(),
  employment_status: z.string().nullable().optional(),
  last_working_date: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const data: Prisma.usersUpdateInput = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === "role" && value !== undefined) data.role = value as UserRole;
      else if (key === "email" && typeof value === "string") data.email = value.toLowerCase();
      else if (key === "last_working_date") data.last_working_date = parseNullableDate(value);
      else if (["is_internal_auditor", "is_admin", "is_active"].includes(key) && value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      } else if (value !== undefined) {
        (data as Record<string, unknown>)[key] = nullableString(value);
      }
    }

    const user = await prisma.users.update({
      where: { id },
      data,
      select: userSelect,
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const user = await prisma.users.update({
      where: { id },
      data: { is_active: false },
      select: userSelect,
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
