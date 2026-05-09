import type { AuditLogAction, Prisma } from "@prisma/client";

import { getAuditLogChangeSummary } from "../audit-log/formatAuditLogEntry";
import { prisma } from "../db/prisma";

export { getAuditLogChangeSummary };

export const AUDIT_LOG_ACTIONS: AuditLogAction[] = [
  "Create",
  "Update",
  "Delete",
  "StatusChange",
  "Login",
  "LoginFailed",
  "Logout",
  "EvidenceUpload",
  "EvidenceReplace",
  "AIExtract",
  "PasswordChange",
  "PasswordReset",
  "AccountLocked",
];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_PAGE = 200;
export const MAX_EXPORT_ROWS = 10000;

export type AuditLogQuery = {
  search?: string | null;
  module?: string | null;
  action?: string | null;
  user_id?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  page?: string | null;
  page_size?: string | null;
};

const auditLogUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  is_admin: true,
} satisfies Prisma.usersSelect;

const auditLogInclude = {
  user: {
    select: auditLogUserSelect,
  },
} satisfies Prisma.audit_logInclude;

type AuditLogRecord = Prisma.audit_logGetPayload<{
  include: typeof auditLogInclude;
}>;

function parsePositiveInt(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateBoundary(value: string | null | undefined, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }

  return date;
}

function isAuditLogAction(value: string | null | undefined): value is AuditLogAction {
  return Boolean(value) && AUDIT_LOG_ACTIONS.includes(value as AuditLogAction);
}

export function getAuditLogPagination(query: AuditLogQuery) {
  const requestedPage = parsePositiveInt(query.page, 1);
  const page = Math.min(requestedPage, MAX_PAGE);
  const pageSize = Math.min(parsePositiveInt(query.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    pageWasCapped: requestedPage > MAX_PAGE,
  };
}

export function buildAuditLogWhere(query: AuditLogQuery): Prisma.audit_logWhereInput {
  const where: Prisma.audit_logWhereInput = {};
  const search = query.search?.trim();
  const dateFrom = parseDateBoundary(query.date_from);
  const dateTo = parseDateBoundary(query.date_to, true);

  if (search) {
    where.OR = [
      { entity_id: { contains: search, mode: "insensitive" } },
      { ip_address: { contains: search, mode: "insensitive" } },
      {
        user: {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
      {
        user: {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
    ];
  }

  if (query.module?.trim()) {
    where.entity_type = query.module.trim();
  }

  if (isAuditLogAction(query.action)) {
    where.action = query.action;
  }

  if (query.user_id?.trim()) {
    where.user_id = query.user_id.trim();
  }

  if (dateFrom || dateTo) {
    where.created_at = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  return where;
}

function normalizeEntityType(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getJsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : null;
}

async function getEntityLookups(entries: AuditLogRecord[]) {
  const actionPlanIds = entries
    .filter((entry) => ["ActionPlan", "action_plans", "Action Plan"].includes(entry.entity_type))
    .map((entry) => entry.entity_id)
    .filter((id): id is string => Boolean(id));
  const userIds = entries
    .filter((entry) => ["User", "users"].includes(entry.entity_type))
    .map((entry) => entry.entity_id)
    .filter((id): id is string => Boolean(id));
  const evidenceIds = entries
    .filter((entry) => ["Evidence", "evidence"].includes(entry.entity_type))
    .map((entry) => entry.entity_id)
    .filter((id): id is string => Boolean(id));

  const [actionPlans, users, evidence] = await Promise.all([
    actionPlanIds.length
      ? prisma.action_plans.findMany({
          where: { id: { in: actionPlanIds } },
          select: { id: true, display_id: true },
        })
      : [],
    userIds.length
      ? prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : [],
    evidenceIds.length
      ? prisma.evidence.findMany({
          where: { id: { in: evidenceIds } },
          select: { id: true, original_name: true, filename: true },
        })
      : [],
  ]);

  return {
    actionPlans: new Map(actionPlans.map((item) => [item.id, item.display_id] as const)),
    users: new Map(users.map((item) => [item.id, item.email] as const)),
    evidence: new Map(evidence.map((item) => [item.id, item.original_name || item.filename] as const)),
  };
}

function shortId(value: string | null) {
  return value ? value.slice(0, 8) : "unknown";
}

function getEntityHref(entry: AuditLogRecord) {
  if (!entry.entity_id) {
    return null;
  }

  if (["ActionPlan", "action_plans", "Action Plan"].includes(entry.entity_type)) {
    return `/action-plans?expand=${entry.entity_id}`;
  }

  if (["Audit", "audits"].includes(entry.entity_type)) {
    return `/audits/${entry.entity_id}`;
  }

  if (["User", "users"].includes(entry.entity_type)) {
    return `/admin?tab=users`;
  }

  return null;
}

export async function serializeAuditLogEntries(entries: AuditLogRecord[]) {
  const lookups = await getEntityLookups(entries);

  return entries.map((entry) => {
    const summary = getAuditLogChangeSummary(entry);
    const entityLabel = normalizeEntityType(entry.entity_type);
    const authEmail =
      getJsonString(entry.after_json, "email") ??
      getJsonString(entry.before_json, "email") ??
      getJsonString(entry.after_json, "user_email") ??
      getJsonString(entry.before_json, "user_email");
    const entityIdentifier =
      lookups.actionPlans.get(entry.entity_id ?? "") ??
      lookups.users.get(entry.entity_id ?? "") ??
      lookups.evidence.get(entry.entity_id ?? "") ??
      getJsonString(entry.after_json, "filename") ??
      getJsonString(entry.after_json, "original_name") ??
      getJsonString(entry.before_json, "filename") ??
      getJsonString(entry.before_json, "original_name") ??
      (["Auth", "Login", "LoginFailed", "Logout"].includes(entry.entity_type) ? authEmail : null) ??
      shortId(entry.entity_id);

    return {
      id: entry.id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_label: entityLabel,
      entity_id: entry.entity_id,
      entity_identifier: entityIdentifier,
      entity_href: getEntityHref(entry),
      before_json: entry.before_json,
      after_json: entry.after_json,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      created_at: entry.created_at.toISOString(),
      user: entry.user,
      change_summary: summary.title,
      change_detail: summary.detail,
    };
  });
}

export function auditLogQueryFromSearchParams(searchParams: URLSearchParams): AuditLogQuery {
  return {
    search: searchParams.get("search"),
    module: searchParams.get("module"),
    action: searchParams.get("action"),
    user_id: searchParams.get("user_id"),
    date_from: searchParams.get("date_from"),
    date_to: searchParams.get("date_to"),
    page: searchParams.get("page"),
    page_size: searchParams.get("page_size"),
  };
}

export async function getAuditLogRows(where: Prisma.audit_logWhereInput, take: number, skip = 0) {
  return prisma.audit_log.findMany({
    where,
    include: auditLogInclude,
    orderBy: {
      created_at: "desc",
    },
    take,
    skip,
  });
}

export async function countAuditLogRows(where: Prisma.audit_logWhereInput) {
  return prisma.audit_log.count({ where });
}
