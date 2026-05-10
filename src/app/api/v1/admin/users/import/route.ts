import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildOrgData,
  changedFields,
  generateUnusablePasswordHash,
  inferRoleFromTeams,
  userSelect,
} from "../../../../../../lib/admin/users";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const importSchema = z.object({
  file_type: z.enum(["active", "leavers"]),
  users: z.array(z.record(z.string(), z.unknown())),
});

const importUserSelect = {
  ...userSelect,
  end_date: true,
};

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const parsed = importSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const batchId = new Date().toISOString();
    const summary = { processed: 0, created: 0, updated: 0, deactivated: 0, skipped: 0, unchanged: 0, notifications: 0 };

    for (const row of parsed.data.users) {
      summary.processed += 1;
      const normalizedRow = normalizeImportRow(row);
      const orgData = {
        ...buildOrgData(normalizedRow),
        last_working_date: parseDate(normalizedRow.last_working_date ?? normalizedRow.end_date),
      };
      const endDate = parseDate(normalizedRow.end_date);
      if (!orgData.email && !orgData.employee_id) {
        if (parsed.data.file_type === "leavers") {
          summary.skipped += 1;
        } else {
          summary.unchanged += 1;
        }
        continue;
      }

      const existing = await prisma.users.findFirst({
        where: {
          OR: [
            ...(orgData.employee_id ? [{ employee_id: orgData.employee_id }] : []),
            ...(orgData.email ? [{ email: { equals: orgData.email, mode: "insensitive" as const } }] : []),
          ],
        },
        select: importUserSelect,
      });

      if (parsed.data.file_type === "active") {
        const activeData = {
          ...getUserSnapshotData(orgData),
          ...(orgData.email ? { email: orgData.email.toLowerCase() } : {}),
          is_active: true,
          employment_status: "Active Employee",
        };

        if (!existing) {
          if (!orgData.email) {
            summary.skipped += 1;
            continue;
          }

          const created = await prisma.users.create({
            data: {
              ...activeData,
              email: orgData.email.toLowerCase(),
              role: inferRoleFromTeams(normalizedRow),
              is_internal_auditor: inferRoleFromTeams(normalizedRow) === "AuditTeam",
              is_admin: false,
              password_hash: await generateUnusablePasswordHash(),
              password_must_change: true,
            },
            select: importUserSelect,
          });
          summary.created += 1;
          await createNotification(created.id, created, "created", null, batchId);
          summary.notifications += 1;
          continue;
        }

        const changes = changedFields(existing, activeData);
        if (changes.length === 0) {
          summary.unchanged += 1;
          continue;
        }

        const updated = await prisma.users.update({
          where: { id: existing.id },
          data: activeData,
          select: importUserSelect,
        });
        summary.updated += 1;
        await createNotification(
          updated.id,
          updated,
          existing.is_active ? changes.join(",") : "became_active",
          existing,
          batchId,
        );
        summary.notifications += 1;
        continue;
      }

      if (!existing) {
        if (!orgData.email) {
          summary.skipped += 1;
          continue;
        }

        const created = await prisma.users.create({
          data: {
            ...getUserSnapshotData(orgData),
            email: orgData.email.toLowerCase(),
            is_active: false,
            employment_status: "Left",
            role: "Auditee",
            is_internal_auditor: false,
            is_admin: false,
            last_working_date: parseDate(normalizedRow.last_working_date ?? normalizedRow.end_date),
            end_date: endDate,
            password_hash: await generateUnusablePasswordHash(),
            password_must_change: true,
          },
          select: importUserSelect,
        });
        summary.created += 1;
        await createNotification(created.id, created, "new_user", null, batchId);
        summary.notifications += 1;
        continue;
      }

      const leaverData = {
        ...getUserSnapshotData(orgData),
        ...(orgData.email ? { email: orgData.email.toLowerCase() } : {}),
        is_active: false,
        employment_status: "Left",
        last_working_date: parseDate(normalizedRow.last_working_date ?? normalizedRow.end_date),
        end_date: endDate,
      };
      const changes = changedFields(existing, leaverData);
      if (changes.length === 0) {
        summary.unchanged += 1;
        continue;
      }

      const updated = await prisma.users.update({
        where: { id: existing.id },
        data: leaverData,
        select: importUserSelect,
      });
      if (existing.is_active) {
        summary.deactivated += 1;
        await createNotification(updated.id, updated, "became_inactive", existing, batchId);
      } else {
        summary.updated += 1;
        await createNotification(updated.id, updated, changes.join(","), existing, batchId);
      }
      summary.notifications += 1;
    }

    return NextResponse.json({ batch_id: batchId, summary });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function normalizeImportRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    employee_id: row.employee_id ?? row.unique_id,
    manager_name: row.manager_name ?? row.manager,
    team_l1: row.team_l1 ?? row.team_level_1,
    team_l2: row.team_l2 ?? row.team_level_2,
    team_l3: row.team_l3 ?? row.team_level_3,
  };
}

function getUserSnapshotData(orgData: ReturnType<typeof buildOrgData>) {
  return {
    employee_id: orgData.employee_id,
    name: orgData.name,
    job_title: orgData.job_title,
    department: orgData.department,
    team_l1: orgData.team_l1,
    team_l2: orgData.team_l2,
    team_l3: orgData.team_l3,
    company: orgData.company,
    location: orgData.location,
    manager_name: orgData.manager_name,
    manager_email: orgData.manager_email,
  };
}

function parseDate(value: unknown) {
  const dateStr = typeof value === "string" ? value.trim() : "";
  if (!dateStr) {
    return null;
  }

  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [monthText, dayText, yearText] = parts;
    const month = Number(monthText);
    const day = Number(dayText);
    const year = Number(yearText);
    const parsed = new Date(year, month - 1, day);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const parsed = new Date(dateStr);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function createNotification(
  userId: string,
  user: { name: string; email: string },
  changeType: string,
  oldValue: unknown,
  batchId: string,
) {
  return prisma.user_import_notifications.create({
    data: {
      user_id: userId,
      user_name: user.name,
      user_email: user.email,
      change_type: changeType,
      old_value: oldValue ? JSON.parse(JSON.stringify(oldValue)) : undefined,
      new_value: JSON.parse(JSON.stringify(user)),
      batch_id: batchId,
    },
  });
}
