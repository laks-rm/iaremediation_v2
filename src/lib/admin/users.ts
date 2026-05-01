import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";

export const USER_ROLES: UserRole[] = ["AuditTeam", "Viewer", "Auditee", "Pending"];

export const userSelect = {
  id: true,
  employee_id: true,
  email: true,
  password_must_change: true,
  failed_login_attempts: true,
  locked_until: true,
  last_login_at: true,
  name: true,
  role: true,
  is_admin: true,
  is_internal_auditor: true,
  is_active: true,
  job_title: true,
  department: true,
  team_l1: true,
  team_l2: true,
  team_l3: true,
  company: true,
  location: true,
  manager_name: true,
  manager_email: true,
  employment_status: true,
  last_working_date: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.usersSelect;

export type SafeAdminUser = Prisma.usersGetPayload<{ select: typeof userSelect }>;

export function nullableString(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseNullableDate(value: unknown) {
  const trimmed = nullableString(value);
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function generateUnusablePasswordHash() {
  return bcrypt.hash(`unusable-${randomBytes(32).toString("hex")}`, 12);
}

export function inferRoleFromTeams(row: Record<string, unknown>) {
  const teamText = [row.team_l1, row.team_l2, row.team_l3, row.department]
    .map((value) => nullableString(value)?.toLowerCase() ?? "")
    .join(" ");

  return teamText.includes("internal audit") ? "AuditTeam" : "Auditee";
}

export function buildOrgData(row: Record<string, unknown>) {
  return {
    employee_id: nullableString(row.employee_id),
    name: nullableString(row.name) ?? nullableString(row.full_name) ?? nullableString(row.email) ?? "Unnamed User",
    email: nullableString(row.email) ?? "",
    job_title: nullableString(row.job_title),
    department: nullableString(row.department),
    team_l1: nullableString(row.team_l1),
    team_l2: nullableString(row.team_l2),
    team_l3: nullableString(row.team_l3),
    company: nullableString(row.company),
    location: nullableString(row.location),
    manager_name: nullableString(row.manager_name),
    manager_email: nullableString(row.manager_email),
    employment_status: nullableString(row.employment_status),
    last_working_date: parseNullableDate(row.last_working_date),
  };
}

export function changedFields(before: SafeAdminUser | null, after: Record<string, unknown>) {
  if (!before) {
    return ["created"];
  }

  return Object.entries(after)
    .filter(([key, value]) => key in before && normalizeComparable(before[key as keyof SafeAdminUser]) !== normalizeComparable(value))
    .map(([key]) => key);
}

function normalizeComparable(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}
