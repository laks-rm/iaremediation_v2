import { ActionPlanStatus, AuditType, CreatedVia, Prisma, Priority } from "@prisma/client";
import { NextRequest } from "next/server";

import { prisma } from "../db/prisma";

export const CLOSED_STATUSES: ActionPlanStatus[] = ["Closed", "Dropped", "RiskAccepted"];
export const PRIORITIES: Priority[] = ["High", "Moderate", "Low"];
export const STATUSES: ActionPlanStatus[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "Closed",
  "RiskAccepted",
  "Dropped",
];
export const STATUS_SORT_ORDER: ActionPlanStatus[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "RiskAccepted",
  "Dropped",
  "Closed",
];
export const AUDIT_TYPES: AuditType[] = [
  "IT",
  "RegulatoryIT",
  "Operations",
  "RegulatoryOperations",
  "External",
];
export const CREATED_VIA_VALUES: CreatedVia[] = ["Manual", "AIIngestion", "Migration", "Standalone"];
export const DUE_BUCKETS = [
  "overdue_gt14",
  "overdue_1to14",
  "due_today",
  "due_this_week",
  "due_this_month",
  "future",
  "no_date",
] as const;
export const SORT_BY_VALUES = [
  "title",
  "audit",
  "owner",
  "status",
  "priority",
  "due_date",
  "evidence_count",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type DueBucket = (typeof DUE_BUCKETS)[number];
export type SortBy = (typeof SORT_BY_VALUES)[number];
export type SortDir = "asc" | "desc";
export type FilterDimension =
  | "ids"
  | "q"
  | "status"
  | "priority"
  | "audit"
  | "owner"
  | "due_bucket"
  | "created_via"
  | "entity"
  | "audit_type"
  | "department"
  | "overdue";

export type ParsedFilters = {
  ids: string[];
  q: string;
  status: ActionPlanStatus[];
  priority: Priority[];
  audit: string[];
  owner: string[];
  due_bucket: DueBucket[];
  created_via: CreatedVia[];
  entity: string[];
  legacyEntityIds: string[];
  audit_type: AuditType[];
  department: string;
  overdue: boolean;
  assigned_to_me: boolean;
  sort_by: SortBy | null;
  sort_dir: SortDir;
};

export function getBooleanParam(request: NextRequest, key: string) {
  return request.nextUrl.searchParams.get(key)?.toLowerCase() === "true";
}

export function getStartOfTodayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getOwnershipScope(userId: string): Prisma.action_plansWhereInput {
  return {
    OR: [
      {
        action_plan_owners: {
          some: {
            user_id: userId,
          },
        },
      },
      {
        action_plan_line_managers: {
          some: {
            user_id: userId,
          },
        },
      },
      {
        action_plan_follow_up_auditors: {
          some: {
            user_id: userId,
          },
        },
      },
    ],
  };
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function parseList(searchParams: URLSearchParams, keys: string[]) {
  return uniqueValues(
    keys
      .flatMap((key) => searchParams.get(key)?.split(",") ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function parseEnumList<T extends string>(
  searchParams: URLSearchParams,
  keys: string[],
  allowedValues: readonly T[],
) {
  const allowed = new Set<string>(allowedValues);
  return parseList(searchParams, keys).filter((value): value is T => allowed.has(value));
}

function parseUuidList(searchParams: URLSearchParams, keys: string[]) {
  return parseList(searchParams, keys).filter((value) => UUID_PATTERN.test(value));
}

function parseEntityCodes(searchParams: URLSearchParams) {
  return parseList(searchParams, ["entity"]).filter((value) => ENTITY_CODE_PATTERN.test(value));
}

function parseStringParam(searchParams: URLSearchParams, keys: string[], maxLength: number) {
  const value = keys.map((key) => searchParams.get(key)?.trim()).find(Boolean) ?? "";
  return value.slice(0, maxLength);
}

export function parseFilters(request: NextRequest): ParsedFilters {
  const searchParams = request.nextUrl.searchParams;
  const sortBy = parseEnumList(searchParams, ["sort_by"], SORT_BY_VALUES)[0] ?? null;
  const sortDir = parseEnumList(searchParams, ["sort_dir"], ["asc", "desc"] as const)[0] ?? "desc";

  return {
    ids: parseUuidList(searchParams, ["ids"]),
    q: parseStringParam(searchParams, ["q", "search"], 200),
    status: parseEnumList(searchParams, ["status"], STATUSES),
    priority: parseEnumList(searchParams, ["priority"], PRIORITIES),
    audit: parseUuidList(searchParams, ["audit", "audit_id"]),
    owner: parseUuidList(searchParams, ["owner", "owner_id"]),
    due_bucket: parseEnumList(searchParams, ["due_bucket"], DUE_BUCKETS),
    created_via: parseEnumList(searchParams, ["created_via"], CREATED_VIA_VALUES),
    entity: parseEntityCodes(searchParams),
    legacyEntityIds: parseUuidList(searchParams, ["entity_id"]),
    audit_type: parseEnumList(searchParams, ["audit_type"], AUDIT_TYPES),
    department: parseStringParam(searchParams, ["department"], 120),
    overdue: searchParams.get("overdue") === "1" || getBooleanParam(request, "overdue_only"),
    assigned_to_me: searchParams.get("assigned_to_me") === "1" || getBooleanParam(request, "assigned_to_me"),
    sort_by: sortBy,
    sort_dir: sortDir,
  };
}

function getDateBoundaries(today: Date) {
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const fourteenDaysAgo = new Date(today.getTime() - 14 * DAY_MS);
  const dayOfWeek = today.getUTCDay();
  const startOfNextWeek = new Date(today.getTime() + (7 - dayOfWeek) * DAY_MS);
  const startOfNextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const endOfThisWeek = new Date(startOfNextWeek.getTime() - 1);
  const endOfThisMonth = new Date(startOfNextMonth.getTime() - 1);

  return {
    tomorrow,
    fourteenDaysAgo,
    endOfThisWeek,
    endOfThisMonth,
  };
}

export function getDueBucketWhere(bucket: DueBucket, today: Date): Prisma.action_plansWhereInput {
  const boundaries = getDateBoundaries(today);

  if (bucket === "overdue_gt14") {
    return {
      current_target_date: {
        lt: boundaries.fourteenDaysAgo,
      },
    };
  }

  if (bucket === "overdue_1to14") {
    return {
      current_target_date: {
        gte: boundaries.fourteenDaysAgo,
        lt: today,
      },
    };
  }

  if (bucket === "due_today") {
    return {
      current_target_date: {
        gte: today,
        lt: boundaries.tomorrow,
      },
    };
  }

  if (bucket === "due_this_week") {
    return {
      current_target_date: {
        gte: today,
        lte: boundaries.endOfThisWeek,
      },
    };
  }

  if (bucket === "due_this_month") {
    return {
      current_target_date: {
        gte: today,
        lte: boundaries.endOfThisMonth,
      },
    };
  }

  if (bucket === "future") {
    return {
      current_target_date: {
        gt: boundaries.endOfThisMonth,
      },
    };
  }

  return {
    current_target_date: null,
  };
}

function getFilterConditions(
  filters: ParsedFilters,
  today: Date,
  omittedDimension?: FilterDimension,
) {
  const conditions: Prisma.action_plansWhereInput[] = [];

  if (omittedDimension !== "ids" && filters.ids.length > 0) {
    conditions.push({ id: { in: filters.ids } });
  }

  if (omittedDimension !== "entity" && filters.legacyEntityIds.length > 0) {
    conditions.push({
      action_plan_entities: {
        some: {
          entity_id: {
            in: filters.legacyEntityIds,
          },
        },
      },
    });
  }

  if (omittedDimension !== "entity" && filters.entity.length > 0) {
    conditions.push({
      action_plan_entities: {
        some: {
          entity: {
            code: {
              in: filters.entity,
            },
          },
        },
      },
    });
  }

  if (omittedDimension !== "audit" && filters.audit.length > 0) {
    conditions.push({
      finding: {
        audit_id: {
          in: filters.audit,
        },
      },
    });
  }

  if (omittedDimension !== "audit_type" && filters.audit_type.length > 0) {
    conditions.push({
      finding: {
        audit: {
          audit_type: {
            in: filters.audit_type,
          },
        },
      },
    });
  }

  if (omittedDimension !== "priority" && filters.priority.length > 0) {
    conditions.push({
      priority: {
        in: filters.priority,
      },
    });
  }

  if (omittedDimension !== "status" && filters.status.length > 0) {
    conditions.push({
      status: {
        in: filters.status,
      },
    });
  }

  if (omittedDimension !== "owner" && filters.owner.length > 0) {
    conditions.push({
      action_plan_owners: {
        some: {
          user_id: {
            in: filters.owner,
          },
        },
      },
    });
  }

  if (omittedDimension !== "created_via" && filters.created_via.length > 0) {
    conditions.push({
      created_via: {
        in: filters.created_via,
      },
    });
  }

  if (omittedDimension !== "due_bucket" && filters.due_bucket.length > 0) {
    conditions.push({
      OR: filters.due_bucket.map((bucket) => getDueBucketWhere(bucket, today)),
    });
  }

  if (omittedDimension !== "department" && filters.department) {
    conditions.push({
      action_plan_owners: {
        some: {
          is_primary: true,
          user: {
            OR: [
              {
                team_l2: {
                  equals: filters.department,
                  mode: "insensitive",
                },
              },
              {
                AND: [
                  {
                    team_l2: null,
                  },
                  {
                    department: {
                      equals: filters.department,
                      mode: "insensitive",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    });
  }

  if (omittedDimension !== "overdue" && filters.overdue) {
    conditions.push({
      current_target_date: {
        lt: today,
      },
      status: {
        notIn: CLOSED_STATUSES,
      },
    });
  }

  if (omittedDimension !== "q" && filters.q) {
    conditions.push({
      OR: [
        {
          display_id: {
            contains: filters.q,
            mode: "insensitive",
          },
        },
        {
          description: {
            contains: filters.q,
            mode: "insensitive",
          },
        },
        {
          finding: {
            title: {
              contains: filters.q,
              mode: "insensitive",
            },
          },
        },
        {
          finding: {
            description: {
              contains: filters.q,
              mode: "insensitive",
            },
          },
        },
        {
          finding: {
            audit: {
              name: {
                contains: filters.q,
                mode: "insensitive",
              },
            },
          },
        },
        {
          action_plan_owners: {
            some: {
              user: {
                name: {
                  contains: filters.q,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      ],
    });
  }

  return conditions;
}

export function buildWhere(
  baseWhere: Prisma.action_plansWhereInput,
  filters: ParsedFilters,
  today: Date,
  omittedDimension?: FilterDimension,
) {
  const conditions = getFilterConditions(filters, today, omittedDimension);

  if (conditions.length === 0) {
    return baseWhere;
  }

  return {
    AND: [baseWhere, ...conditions],
  } satisfies Prisma.action_plansWhereInput;
}

export function getPrismaOrderBy(filters: ParsedFilters): Prisma.action_plansOrderByWithRelationInput[] {
  if (filters.sort_by === "title") {
    return [{ finding: { title: filters.sort_dir } }, { updated_at: "desc" }];
  }

  if (filters.sort_by === "audit") {
    return [{ finding: { audit: { name: filters.sort_dir } } }, { updated_at: "desc" }];
  }

  if (filters.sort_by === "due_date") {
    return [{ current_target_date: { sort: filters.sort_dir, nulls: "last" } }, { updated_at: "desc" }];
  }

  return [{ updated_at: "desc" }];
}

function rawSortDirection(sortDir: SortDir) {
  return sortDir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}

function getStatusCaseSql() {
  return Prisma.sql`CASE ap.status::text
    WHEN 'NotStarted' THEN 0
    WHEN 'InProgress' THEN 1
    WHEN 'PendingValidation' THEN 2
    WHEN 'RiskAccepted' THEN 3
    WHEN 'Dropped' THEN 4
    WHEN 'Closed' THEN 5
    ELSE 6
  END`;
}

function getPriorityCaseSql() {
  return Prisma.sql`CASE ap.priority::text
    WHEN 'High' THEN 0
    WHEN 'Moderate' THEN 1
    WHEN 'Low' THEN 2
    ELSE 3
  END`;
}

export function usesRawSort(filters: ParsedFilters) {
  return (
    filters.sort_by === "status" ||
    filters.sort_by === "priority" ||
    filters.sort_by === "owner" ||
    filters.sort_by === "evidence_count"
  );
}

export async function getRawSortedIds(
  where: Prisma.action_plansWhereInput,
  filters: ParsedFilters,
  take?: number,
) {
  const matchingIds = await prisma.action_plans.findMany({
    where,
    select: {
      id: true,
    },
  });
  const ids = matchingIds.map((actionPlan) => actionPlan.id);

  if (ids.length === 0) {
    return [];
  }

  const idFilter = Prisma.sql`ap.id::text IN (${Prisma.join(ids)})`;
  const direction = rawSortDirection(filters.sort_dir);
  const limitSql = typeof take === "number" ? Prisma.sql`LIMIT ${take}` : Prisma.empty;

  if (filters.sort_by === "status") {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT ap.id::text AS id
      FROM action_plans ap
      WHERE ${idFilter}
      ORDER BY ${getStatusCaseSql()} ${direction}, ap.updated_at DESC
      ${limitSql}
    `;
    return rows.map((row) => row.id);
  }

  if (filters.sort_by === "priority") {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT ap.id::text AS id
      FROM action_plans ap
      WHERE ${idFilter}
      ORDER BY ${getPriorityCaseSql()} ${direction}, ap.updated_at DESC
      ${limitSql}
    `;
    return rows.map((row) => row.id);
  }

  if (filters.sort_by === "owner") {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT ap.id::text AS id
      FROM action_plans ap
      LEFT JOIN action_plan_owners apo
        ON apo.action_plan_id = ap.id
        AND apo.is_primary = true
      LEFT JOIN users owner_user
        ON owner_user.id = apo.user_id
      WHERE ${idFilter}
      ORDER BY (owner_user.name IS NULL) ASC, lower(owner_user.name) ${direction}, ap.updated_at DESC
      ${limitSql}
    `;
    return rows.map((row) => row.id);
  }

  if (filters.sort_by === "evidence_count") {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT ap.id::text AS id
      FROM action_plans ap
      LEFT JOIN (
        SELECT action_plan_id, COUNT(*)::int AS evidence_count
        FROM evidence
        WHERE is_deleted = false
        GROUP BY action_plan_id
      ) evidence_counts
        ON evidence_counts.action_plan_id = ap.id
      WHERE ${idFilter}
      ORDER BY COALESCE(evidence_counts.evidence_count, 0) ${direction}, ap.updated_at DESC
      ${limitSql}
    `;
    return rows.map((row) => row.id);
  }

  return [];
}
