import type { Prisma, PrismaClient } from "@prisma/client";

import { AUDIT_TYPE_LABELS } from "../constants";

export const CLOSURE_RATE_THRESHOLDS = {
  good: 80,
  warning: 50,
} as const;

export type ClosurePeriod =
  | { type: "as_on"; date: Date }
  | { type: "range"; from: Date; to: Date };

export type ClosureKpiResult = {
  due: number;
  closed: number;
  rate: number | null;
};

export type ClosureKpiRow = {
  dimension: string;
  due: number;
  closed: number;
  rate: number | null;
  actionPlanIds: string[];
  closedIds: string[];
};

export type ClosureDimension = "audit_type" | "audit_name" | "follow_up_auditor" | "department";

type ClosurePrismaClient = Pick<PrismaClient, "action_plans">;

type DimensionActionPlan = Awaited<ReturnType<typeof getActionPlansForDimension>>[number];

const EXCLUDED_DENOMINATOR_STATUSES = ["Dropped", "RiskAccepted"] as const;
const UNASSIGNED_DIMENSION = "Unassigned";
const STANDALONE_DIMENSION = "Standalone";

function getTargetDateWhere(period: ClosurePeriod): Prisma.action_plansWhereInput {
  if (period.type === "as_on") {
    return {
      current_target_date: {
        lte: period.date,
      },
    };
  }

  return {
    current_target_date: {
      gte: period.from,
      lte: period.to,
    },
  };
}

function getClosedAtWhere(period: ClosurePeriod): Prisma.action_plansWhereInput {
  if (period.type === "as_on") {
    return {
      closed_at: {
        lte: period.date,
      },
    };
  }

  return {
    closed_at: {
      gte: period.from,
      lte: period.to,
    },
  };
}

function buildDenominatorWhere(period: ClosurePeriod): Prisma.action_plansWhereInput {
  return {
    is_deleted: false,
    status: {
      notIn: [...EXCLUDED_DENOMINATOR_STATUSES],
    },
    ...getTargetDateWhere(period),
  };
}

function buildNumeratorWhere(period: ClosurePeriod): Prisma.action_plansWhereInput {
  return {
    AND: [
      buildDenominatorWhere(period),
      {
        status: "Closed",
      },
      getClosedAtWhere(period),
    ],
  };
}

function getRate(closed: number, due: number) {
  if (due === 0) {
    return null;
  }

  return Math.round((closed / due) * 1000) / 10;
}

function isClosedWithinPeriod(actionPlan: DimensionActionPlan, period: ClosurePeriod) {
  if (actionPlan.status !== "Closed" || !actionPlan.closed_at) {
    return false;
  }

  if (period.type === "as_on") {
    return actionPlan.closed_at <= period.date;
  }

  return actionPlan.closed_at >= period.from && actionPlan.closed_at <= period.to;
}

function getDimensionValue(actionPlan: DimensionActionPlan, dimension: ClosureDimension) {
  if (dimension === "audit_type") {
    const auditType = actionPlan.finding.audit?.audit_type;
    return auditType ? AUDIT_TYPE_LABELS[auditType] : STANDALONE_DIMENSION;
  }

  if (dimension === "audit_name") {
    return actionPlan.finding.audit?.name ?? STANDALONE_DIMENSION;
  }

  if (dimension === "follow_up_auditor") {
    return actionPlan.action_plan_follow_up_auditors[0]?.user.name ?? UNASSIGNED_DIMENSION;
  }

  const owner = actionPlan.action_plan_owners[0]?.user;
  return owner?.team_l2?.trim() || owner?.department?.trim() || UNASSIGNED_DIMENSION;
}

function sortRows(rows: ClosureKpiRow[]) {
  return rows.sort((left, right) => {
    if (left.rate === null && right.rate !== null) return 1;
    if (left.rate !== null && right.rate === null) return -1;
    if (left.rate !== null && right.rate !== null && left.rate !== right.rate) {
      return right.rate - left.rate;
    }

    return left.dimension.localeCompare(right.dimension);
  });
}

async function getActionPlansForDimension(
  dimension: ClosureDimension,
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
) {
  const include = {
    finding: {
      include: {
        audit: true,
      },
    },
    action_plan_follow_up_auditors: {
      orderBy: {
        assigned_at: "asc",
      },
      take: 1,
      include: {
        user: true,
      },
    },
    action_plan_owners: {
      where: {
        is_primary: true,
      },
      orderBy: {
        assigned_at: "asc",
      },
      take: 1,
      include: {
        user: true,
      },
    },
  } satisfies Prisma.action_plansInclude;

  return prisma.action_plans.findMany({
    where: buildDenominatorWhere(period),
    orderBy: {
      id: "asc",
    },
    include:
      dimension === "audit_type" || dimension === "audit_name"
        ? { finding: include.finding }
        : dimension === "follow_up_auditor"
          ? { action_plan_follow_up_auditors: include.action_plan_follow_up_auditors }
          : { action_plan_owners: include.action_plan_owners },
  });
}

export async function getOverallClosureKpi(
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
): Promise<ClosureKpiResult> {
  const [due, closed] = await Promise.all([
    prisma.action_plans.count({
      where: buildDenominatorWhere(period),
    }),
    prisma.action_plans.count({
      where: buildNumeratorWhere(period),
    }),
  ]);

  return {
    due,
    closed,
    rate: getRate(closed, due),
  };
}

export async function getClosureKpiByDimension(
  dimension: ClosureDimension,
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
): Promise<ClosureKpiRow[]> {
  const actionPlans = await getActionPlansForDimension(dimension, period, prisma);
  const groups = new Map<string, { actionPlanIds: string[]; closedIds: string[] }>();

  for (const actionPlan of actionPlans) {
    const dimensionValue = getDimensionValue(actionPlan, dimension);
    const group = groups.get(dimensionValue) ?? { actionPlanIds: [], closedIds: [] };

    group.actionPlanIds.push(actionPlan.id);
    if (isClosedWithinPeriod(actionPlan, period)) {
      group.closedIds.push(actionPlan.id);
    }

    groups.set(dimensionValue, group);
  }

  return sortRows(
    [...groups.entries()].map(([dimensionValue, group]) => ({
      dimension: dimensionValue,
      due: group.actionPlanIds.length,
      closed: group.closedIds.length,
      rate: getRate(group.closedIds.length, group.actionPlanIds.length),
      actionPlanIds: group.actionPlanIds,
      closedIds: group.closedIds,
    })),
  );
}

export async function getClosureKpiDrillDown(
  dimension: ClosureDimension,
  dimensionValue: string,
  period: ClosurePeriod,
  prisma: ClosurePrismaClient,
): Promise<{ dueIds: string[]; closedIds: string[] }> {
  const rows = await getClosureKpiByDimension(dimension, period, prisma);
  const row = rows.find((candidate) => candidate.dimension === dimensionValue);

  return {
    dueIds: row?.actionPlanIds ?? [],
    closedIds: row?.closedIds ?? [],
  };
}
