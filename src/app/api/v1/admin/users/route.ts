import { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  generateUnusablePasswordHash,
  nullableString,
  userSelect,
  USER_ROLES,
} from "../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  role: z.enum(["AuditTeam", "Viewer", "Auditee", "Pending"]),
  is_internal_auditor: z.boolean().optional().default(false),
  is_admin: z.boolean().optional().default(false),
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
});

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.users.findMany({
      select: userSelect,
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const parsed = createUserSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success || !USER_ROLES.includes(parsed.data.role as UserRole)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const user = await prisma.users.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role as UserRole,
        is_internal_auditor: parsed.data.is_internal_auditor,
        is_admin: parsed.data.is_admin,
        password_hash: await generateUnusablePasswordHash(),
        password_must_change: true,
        employee_id: nullableString(parsed.data.employee_id),
        job_title: nullableString(parsed.data.job_title),
        department: nullableString(parsed.data.department),
        team_l1: nullableString(parsed.data.team_l1),
        team_l2: nullableString(parsed.data.team_l2),
        team_l3: nullableString(parsed.data.team_l3),
        company: nullableString(parsed.data.company),
        location: nullableString(parsed.data.location),
        manager_name: nullableString(parsed.data.manager_name),
        manager_email: nullableString(parsed.data.manager_email),
        employment_status: nullableString(parsed.data.employment_status),
      },
      select: userSelect,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
