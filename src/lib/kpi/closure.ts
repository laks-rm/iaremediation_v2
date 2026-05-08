import type { ActionPlanStatus, Prisma, PrismaClient } from "@prisma/client";

import { AUDIT_TYPE_LABELS } from "../constants";

// ---------------------------------------------------------------------------
// Constants (module scope — not exported)
// ---------------------------------------------------------------------------

const OPEN_STATUSES = ["NotStarted", "InProgress", "PendingValidation"] as const satisfies readonly ActionPlanStatus[];
const EXCLUDED_STATUSES = ["Dropped", "RiskAccepted"] as const satisfies readonly ActionPlanStatus[];
const STANDALONE_LABEL = "Standalone";
const UNASSIGNED_LABEL = "Unassigned";
const NO_PRIORITY_LABEL = "No Priority";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrow window used by pure KPI helpers (`status_history`, date bounds). */
export type ClosurePeriodCanonical = { from: Date; to: Date };

/** Query-param shape produced by KPI routes (`period_type=as_on`). */
export type LegacyClosurePeriodPayload =
  | { type: "as_on"; date: Date }
  | { type: "range"; from: Date; to: Date };

/** Canonical `{ from, to }` interval, plus legacy payloads until callers normalize to Prompt 2. */
export type ClosurePeriod = ClosurePeriodCanonical | LegacyClosurePeriodPayload;

function resolveClosurePeriod(period: ClosurePeriod): ClosurePeriodCanonical {
  if ("type" in period) {
    if (period.type === "as_on") {
      const d = period.date;
      const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const to = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
      );
      return { from, to };
    }
    return { from: period.from, to: period.to };
  }
  return period;
}

export type ClosureKpiResult = {
  due_in_period: number;
  overdue_brought_forward: number;
  due: number;
  closed: number;
  closure_rate: number | null;
  overdue_at_period_end: number;
  overdue_created_in_period: number;
  net_movement: number;
  reschedule_rate: number | null;
  risk_accepted: number;
  dropped: number;
};

export type ClosureKpiRow = ClosureKpiResult & {
  dimension: string;
  due_in_period_ids: string[];
  overdue_brought_forward_ids: string[];
  closed_ids: string[];
  overdue_at_period_end_ids: string[];
};

export type ActionPlanSummary = {
  id: string;
  display_id: string;
  description: string;
  priority: string | null;
  status: string;
  current_target_date: Date | null;
  original_target_date: Date | null;
  closed_at: Date | null;
  reschedule_count: number;
  audit_name: string | null;
  audit_type: string | null;
  owner: string | null;
  department: string | null;
  team_l1: string | null;
  entities: string[];
  buckets: Array<"due_in_period" | "overdue_brought_forward" | "closed" | "overdue_at_period_end">;
};

export type ClosureDrillDownResult = {
  dimension: string;
  dimension_value: string;
  period: ClosurePeriodCanonical;
  buckets: {
    due_in_period: ActionPlanSummary[];
    overdue_brought_forward: ActionPlanSummary[];
    closed: ActionPlanSummary[];
    overdue_at_period_end: ActionPlanSummary[];
  };
};

export type ClosureDimension =
  | "audit_type"
  | "audit_name"
  | "follow_up_auditor"
  | "department"
  | "team_l1"
  | "entity"
  | "priority";

export const ALL_DIMENSIONS: ClosureDimension[] = [
  "audit_type",
  "audit_name",
  "follow_up_auditor",
  "department",
  "team_l1",
  "entity",
  "priority",
];

export const CLOSURE_RATE_THRESHOLDS = { good: 80, warning: 50 } as const;

// ---------------------------------------------------------------------------
// Prisma / fetch types
// ---------------------------------------------------------------------------

type ClosurePrismaClient = Pick<PrismaClient, "action_plans">;

function fetchActionPlansInclude(period: ClosurePeriodCanonical) {
  return {
    finding: {
      include: {
        audit: {
          select: {
            name: true,
            audit_type: true,
          },
        },
      },
    },
    action_plan_follow_up_auditors: {
      orderBy: { assigned_at: "asc" },
      take: 1,
      include: {
        user: { select: { name: true } },
      },
    },
    action_plan_owners: {
      where: { is_primary: true },
      orderBy: { assigned_at: "asc" },
      take: 1,
      include: {
        user: { select: { name: true, department: true, team_l1: true } },
      },
    },
    action_plan_entities: {
      include: {
        entity: { select: { code: true, full_name: true } },
      },
    },
    status_history: {
      where: { changed_at: { lte: period.to } },
      orderBy: { changed_at: "asc" },
      select: { to_status: true, from_status: true, changed_at: true },
    },
  } satisfies Prisma.action_plansInclude;
}

export type FetchedActionPlan = Prisma.action_plansGetPayload<{
  include: ReturnType<typeof fetchActionPlansInclude>;
}>;

// ---------------------------------------------------------------------------
// Point-in-time status
// ---------------------------------------------------------------------------

function isOpenStatus(status: ActionPlanStatus | null | undefined): boolean {
  if (status === null || status === undefined) {
    return false;
  }
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Pure — expects `ap.status_history` filtered to changed_at <= period.to and ordered ascending by changed_at.
 */
export function getStatusAsAt(ap: FetchedActionPlan, asAt: Date): ActionPlanStatus {
  const history = ap.status_history;
  const beforeOrAt = history.filter((entry) => entry.changed_at <= asAt);

  if (beforeOrAt.length > 0) {
    return beforeOrAt[beforeOrAt.length - 1]!.to_status;
  }

  if (history.length > 0) {
    const first = history[0]!;
    return first.from_status ?? "NotStarted";
  }

  return "NotStarted";
}

// ---------------------------------------------------------------------------
// fetchActionPlans
// ---------------------------------------------------------------------------

export async function fetchActionPlans(
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<FetchedActionPlan[]> {
  const p = resolveClosurePeriod(period);

  return prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { notIn: [...EXCLUDED_STATUSES] },
      OR: [{ current_target_date: { lte: p.to } }, { closed_at: { gte: p.from, lte: p.to } }],
      finding: {
        finding_type: includeOfi ? undefined : { not: "OpportunityForImprovement" },
      },
    },
    orderBy: { id: "asc" },
    include: fetchActionPlansInclude(p),
  });
}

async function fetchExcludedActionPlans(
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<FetchedActionPlan[]> {
  const p = resolveClosurePeriod(period);

  return prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { in: [...EXCLUDED_STATUSES] },
      current_target_date: { gte: p.from, lte: p.to },
      finding: {
        finding_type: includeOfi ? undefined : { not: "OpportunityForImprovement" },
      },
    },
    orderBy: { id: "asc" },
    include: fetchActionPlansInclude(p),
  });
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function isDueInPeriod(ap: FetchedActionPlan, period: ClosurePeriodCanonical): boolean {
  const t = ap.current_target_date;
  if (!t) {
    return false;
  }
  return t >= period.from && t <= period.to;
}

export function isOverdueBroughtForward(ap: FetchedActionPlan, period: ClosurePeriodCanonical): boolean {
  const t = ap.current_target_date;
  if (!t || t >= period.from) {
    return false;
  }
  return isOpenStatus(getStatusAsAt(ap, period.from));
}

export function isClosedInPeriod(ap: FetchedActionPlan, period: ClosurePeriodCanonical): boolean {
  const c = ap.closed_at;
  if (!c) {
    return false;
  }
  return c >= period.from && c <= period.to;
}

export function isOverdueAtPeriodEnd(ap: FetchedActionPlan, period: ClosurePeriodCanonical): boolean {
  const t = ap.current_target_date;
  if (!t || t > period.to) {
    return false;
  }
  return isOpenStatus(getStatusAsAt(ap, period.to));
}

// ---------------------------------------------------------------------------
// Dimension values
// ---------------------------------------------------------------------------

export function getDimensionValues(ap: FetchedActionPlan, dimension: ClosureDimension): string[] {
  if (dimension === "audit_type") {
    const label = ap.finding.audit?.audit_type
      ? AUDIT_TYPE_LABELS[ap.finding.audit.audit_type]
      : STANDALONE_LABEL;
    return [label];
  }

  if (dimension === "audit_name") {
    return [ap.finding.audit?.name ?? STANDALONE_LABEL];
  }

  if (dimension === "follow_up_auditor") {
    return [ap.action_plan_follow_up_auditors[0]?.user.name ?? UNASSIGNED_LABEL];
  }

  if (dimension === "department") {
    const raw = ap.action_plan_owners[0]?.user.department?.trim();
    return [raw && raw.length > 0 ? raw : UNASSIGNED_LABEL];
  }

  if (dimension === "team_l1") {
    const raw = ap.action_plan_owners[0]?.user.team_l1?.trim();
    return [raw && raw.length > 0 ? raw : UNASSIGNED_LABEL];
  }

  if (dimension === "entity") {
    if (ap.action_plan_entities.length === 0) {
      return [UNASSIGNED_LABEL];
    }
    return ap.action_plan_entities.map((row) => row.entity.code);
  }

  return [ap.priority ?? NO_PRIORITY_LABEL];
}

function roundRate(closed: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return Math.round((closed / denominator) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

export function computeKpiResult(
  aps: FetchedActionPlan[],
  period: ClosurePeriodCanonical,
  excludedAps: FetchedActionPlan[] = [],
): ClosureKpiResult {
  let dueInPeriod = 0;
  let overdueBroughtForward = 0;
  let closed = 0;
  let overdueAtPeriodEnd = 0;
  let overdueCreatedInPeriod = 0;
  let rescheduleNumerator = 0;

  for (const ap of aps) {
    if (isDueInPeriod(ap, period)) {
      dueInPeriod += 1;
      if (ap.reschedule_count > 0) {
        rescheduleNumerator += 1;
      }
    }
    if (isOverdueBroughtForward(ap, period)) {
      overdueBroughtForward += 1;
    }
    if (isClosedInPeriod(ap, period)) {
      closed += 1;
    }
    if (isOverdueAtPeriodEnd(ap, period)) {
      overdueAtPeriodEnd += 1;
    }
    if (isDueInPeriod(ap, period) && isOverdueAtPeriodEnd(ap, period)) {
      overdueCreatedInPeriod += 1;
    }
  }

  let riskAccepted = 0;
  let dropped = 0;

  for (const ap of excludedAps) {
    if (isDueInPeriod(ap, period)) {
      if (ap.status === "RiskAccepted") {
        riskAccepted += 1;
      } else if (ap.status === "Dropped") {
        dropped += 1;
      }
    }
  }

  const due = dueInPeriod + overdueBroughtForward;
  const closureRate = roundRate(closed, due);
  const rescheduleRate = dueInPeriod === 0 ? null : Math.round((rescheduleNumerator / dueInPeriod) * 1000) / 10;
  const netMovement = closed - overdueCreatedInPeriod;

  return {
    due_in_period: dueInPeriod,
    overdue_brought_forward: overdueBroughtForward,
    due,
    closed,
    closure_rate: closureRate,
    overdue_at_period_end: overdueAtPeriodEnd,
    overdue_created_in_period: overdueCreatedInPeriod,
    net_movement: netMovement,
    reschedule_rate: rescheduleRate,
    risk_accepted: riskAccepted,
    dropped: dropped,
  };
}

export function computeKpiRows(
  aps: FetchedActionPlan[],
  dimension: ClosureDimension,
  period: ClosurePeriodCanonical,
  excludedAps: FetchedActionPlan[] = [],
): ClosureKpiRow[] {
  const dimensionValues = new Set<string>();
  for (const ap of aps) {
    for (const value of getDimensionValues(ap, dimension)) {
      dimensionValues.add(value);
    }
  }
  for (const ap of excludedAps) {
    for (const value of getDimensionValues(ap, dimension)) {
      dimensionValues.add(value);
    }
  }

  const rows: ClosureKpiRow[] = [...dimensionValues].map((dimensionValue) => {
    const slice = aps.filter((ap) => getDimensionValues(ap, dimension).includes(dimensionValue));
    const excludedSlice = excludedAps.filter((ap) => getDimensionValues(ap, dimension).includes(dimensionValue));
    const base = computeKpiResult(slice, period, excludedSlice);

    const due_in_period_ids: string[] = [];
    const overdue_brought_forward_ids: string[] = [];
    const closed_ids: string[] = [];
    const overdue_at_period_end_ids: string[] = [];

    for (const ap of slice) {
      if (isDueInPeriod(ap, period)) {
        due_in_period_ids.push(ap.id);
      }
      if (isOverdueBroughtForward(ap, period)) {
        overdue_brought_forward_ids.push(ap.id);
      }
      if (isClosedInPeriod(ap, period)) {
        closed_ids.push(ap.id);
      }
      if (isOverdueAtPeriodEnd(ap, period)) {
        overdue_at_period_end_ids.push(ap.id);
      }
    }

    return {
      ...base,
      dimension: dimensionValue,
      due_in_period_ids,
      overdue_brought_forward_ids,
      closed_ids,
      overdue_at_period_end_ids,
    };
  });

  return rows.sort((left, right) => {
    if (left.closure_rate === null && right.closure_rate !== null) {
      return 1;
    }
    if (left.closure_rate !== null && right.closure_rate === null) {
      return -1;
    }
    if (left.closure_rate !== null && right.closure_rate !== null && left.closure_rate !== right.closure_rate) {
      return right.closure_rate - left.closure_rate;
    }
    return left.dimension.localeCompare(right.dimension);
  });
}

function resolveBuckets(
  ap: FetchedActionPlan,
  period: ClosurePeriodCanonical,
): Array<"due_in_period" | "overdue_brought_forward" | "closed" | "overdue_at_period_end"> {
  const buckets: Array<"due_in_period" | "overdue_brought_forward" | "closed" | "overdue_at_period_end"> = [];
  if (isClosedInPeriod(ap, period)) {
    buckets.push("closed");
  }
  if (isDueInPeriod(ap, period)) {
    buckets.push("due_in_period");
  }
  if (isOverdueBroughtForward(ap, period)) {
    buckets.push("overdue_brought_forward");
  }
  if (isOverdueAtPeriodEnd(ap, period)) {
    buckets.push("overdue_at_period_end");
  }
  return buckets;
}

export function toActionPlanSummary(
  ap: FetchedActionPlan,
  buckets: ActionPlanSummary["buckets"],
  _period: ClosurePeriodCanonical,
): ActionPlanSummary {
  const audit = ap.finding.audit;
  let auditName: string | null = audit?.name ?? null;
  if (!auditName && ap.finding.is_standalone) {
    auditName = STANDALONE_LABEL;
  }

  const auditTypeLabel = audit?.audit_type ? AUDIT_TYPE_LABELS[audit.audit_type] : null;

  const primaryOwner = ap.action_plan_owners[0]?.user;

  return {
    id: ap.id,
    display_id: ap.display_id,
    description: ap.description,
    priority: ap.priority != null ? String(ap.priority) : null,
    status: ap.status,
    current_target_date: ap.current_target_date,
    original_target_date: ap.original_target_date,
    closed_at: ap.closed_at,
    reschedule_count: ap.reschedule_count,
    audit_name: auditName,
    audit_type: auditTypeLabel,
    owner: primaryOwner?.name ?? null,
    department: primaryOwner?.department?.trim() ?? null,
    team_l1: primaryOwner?.team_l1?.trim() ?? null,
    entities: ap.action_plan_entities.map((row) => row.entity.code),
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getAllClosureKpis(
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<{
  overall: ClosureKpiResult;
  byAuditType: ClosureKpiRow[];
  byAuditName: ClosureKpiRow[];
  byFollowUpAuditor: ClosureKpiRow[];
  byDepartment: ClosureKpiRow[];
  byTeamL1: ClosureKpiRow[];
  byEntity: ClosureKpiRow[];
  byPriority: ClosureKpiRow[];
}> {
  const p = resolveClosurePeriod(period);
  const aps = await fetchActionPlans(period, prisma, includeOfi);
  const excludedAps = await fetchExcludedActionPlans(period, prisma, includeOfi);

  return {
    overall: computeKpiResult(aps, p, excludedAps),
    byAuditType: computeKpiRows(aps, "audit_type", p, excludedAps),
    byAuditName: computeKpiRows(aps, "audit_name", p, excludedAps),
    byFollowUpAuditor: computeKpiRows(aps, "follow_up_auditor", p, excludedAps),
    byDepartment: computeKpiRows(aps, "department", p, excludedAps),
    byTeamL1: computeKpiRows(aps, "team_l1", p, excludedAps),
    byEntity: computeKpiRows(aps, "entity", p, excludedAps),
    byPriority: computeKpiRows(aps, "priority", p, excludedAps),
  };
}

export async function getClosureKpiDrillDown(
  dimension: ClosureDimension,
  dimensionValue: string,
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<
  ClosureDrillDownResult & {
    dueIds: string[];
    closedIds: string[];
  }
> {
  const p = resolveClosurePeriod(period);
  const aps = await fetchActionPlans(period, prisma, includeOfi);
  const filtered = aps.filter((ap) => getDimensionValues(ap, dimension).includes(dimensionValue));

  const buckets: ClosureDrillDownResult["buckets"] = {
    due_in_period: [],
    overdue_brought_forward: [],
    closed: [],
    overdue_at_period_end: [],
  };

  for (const ap of filtered) {
    const b = resolveBuckets(ap, p);
    const summary = toActionPlanSummary(ap, b, p);
    if (b.includes("due_in_period")) {
      buckets.due_in_period.push(summary);
    }
    if (b.includes("overdue_brought_forward")) {
      buckets.overdue_brought_forward.push(summary);
    }
    if (b.includes("closed")) {
      buckets.closed.push(summary);
    }
    if (b.includes("overdue_at_period_end")) {
      buckets.overdue_at_period_end.push(summary);
    }
  }

  const dueIds = filtered.map((ap) => ap.id);
  const closedIds = filtered.filter((ap) => isClosedInPeriod(ap, p)).map((ap) => ap.id);

  return {
    dimension,
    dimension_value: dimensionValue,
    period: p,
    buckets,
    dueIds,
    closedIds,
  };
}

export function getClosureKpiTrend(
  actionPlans: FetchedActionPlan[],
  periods: Array<{ period_label: string; from: Date; to: Date }>,
): Array<{ period_label: string; from: Date; to: Date } & ClosureKpiResult> {
  return periods.map(({ period_label, from, to }) => ({
    period_label,
    from,
    to,
    ...computeKpiResult(actionPlans, { from, to }),
  }));
}

// ---------------------------------------------------------------------------
// Legacy `/api/v1/kpi/closure` shapes — remove when UI is on new KPI fields
// ---------------------------------------------------------------------------

export type ClosureKpiLegacyResult = {
  due: number;
  closed: number;
  rate: number | null;
};

export type ClosureKpiLegacyRow = {
  dimension: string;
  due: number;
  closed: number;
  rate: number | null;
  actionPlanIds: string[];
  closedIds: string[];
};

export async function getOverallClosureKpi(
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<ClosureKpiLegacyResult> {
  const p = resolveClosurePeriod(period);
  const aps = await fetchActionPlans(period, prisma, includeOfi);
  const excludedAps = await fetchExcludedActionPlans(period, prisma, includeOfi);
  const overall = computeKpiResult(aps, p, excludedAps);

  return {
    due: overall.due,
    closed: overall.closed,
    rate: overall.closure_rate,
  };
}

export async function getClosureKpiByDimension(
  dimension: ClosureDimension,
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
  includeOfi: boolean = false,
): Promise<ClosureKpiLegacyRow[]> {
  const p = resolveClosurePeriod(period);
  const aps = await fetchActionPlans(period, prisma, includeOfi);
  const excludedAps = await fetchExcludedActionPlans(period, prisma, includeOfi);
  const rows = computeKpiRows(aps, dimension, p, excludedAps);

  return rows.map((row) => ({
    dimension: row.dimension,
    due: row.due,
    closed: row.closed,
    rate: row.closure_rate,
    actionPlanIds: aps.filter((ap) => getDimensionValues(ap, dimension).includes(row.dimension)).map((ap) => ap.id),
    closedIds: row.closed_ids,
  }));
}
