import { ActionPlanStatus, PrismaClient } from "@prisma/client";
import crypto from "crypto";

import { prisma as defaultPrisma } from "../../db/prisma";
import { clusterByTheme } from "./theme";
import type { AiInsightCard, InsightConfidence, InsightSeverity, InsightType } from "./types";

const CLOSED_STATUSES: ActionPlanStatus[] = ["Closed", "Dropped", "RiskAccepted"];
const OPEN_STATUSES: ActionPlanStatus[] = ["NotStarted", "InProgress", "PendingValidation"];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEAK_REMARK_PATTERNS = [/\bverbal\b/i, /\bdiscussed\b/i, /\bagreed\b/i, /\bokay\b/i];

type InsightAnalyser = (client?: PrismaClient) => Promise<AiInsightCard[]>;

type ActivityItem = {
  created_at?: Date;
  changed_at?: Date;
  revised_at?: Date;
};

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function daysBetween(left: Date, right: Date) {
  return Math.floor((right.getTime() - left.getTime()) / DAY_MS);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue));
  return sorted[index];
}

function latestActivityDate(createdAt: Date, activityGroups: ActivityItem[][]) {
  const dates = activityGroups
    .flat()
    .map((item) => item.created_at ?? item.changed_at ?? item.revised_at)
    .filter((date): date is Date => Boolean(date));
  return dates.length > 0
    ? new Date(Math.max(...dates.map((date) => date.getTime())))
    : createdAt;
}

function severityByCount(count: number, highPriorityCount = 0): InsightSeverity {
  if (highPriorityCount >= 3 || count >= 10) return "High";
  if (highPriorityCount >= 1 || count >= 3) return "Moderate";
  return "Low";
}

function makeCard(input: {
  cardVersion: string;
  insightType: InsightType;
  severity: InsightSeverity;
  confidence: InsightConfidence;
  headline: string;
  findings: Record<string, unknown>;
  actionPlanIds: string[];
  findingIds: string[];
  drillThroughFilter?: Omit<AiInsightCard["drillThroughFilter"], "ids">;
  supportingNumbers: AiInsightCard["supportingNumbers"];
}): AiInsightCard {
  const actionPlanIds = unique(input.actionPlanIds);
  const findingIds = unique(input.findingIds);
  const id = crypto
    .createHash("sha256")
    .update(`${input.cardVersion}:${input.headline}:${actionPlanIds.sort().join(",")}`)
    .digest("hex")
    .slice(0, 16);

  return {
    id,
    cardVersion: input.cardVersion,
    insightType: input.insightType,
    severity: input.severity,
    confidence: input.confidence,
    headline: input.headline,
    narrative: "",
    findings: input.findings,
    relatedItems: {
      actionPlanIds,
      findingIds,
    },
    drillThroughFilter: {
      ...input.drillThroughFilter,
      ids: actionPlanIds,
    },
    supportingNumbers: input.supportingNumbers,
  };
}

function primaryDepartment(actionPlan: { department: string | null; action_plan_owners: { user: { department: string | null } }[] }) {
  return actionPlan.action_plan_owners[0]?.user.department ?? actionPlan.department ?? "Unassigned";
}

export const analyseThematicOpenFindingClusters: InsightAnalyser = async (client = defaultPrisma) => {
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { notIn: CLOSED_STATUSES },
    },
    select: {
      id: true,
      priority: true,
      finding: {
        select: {
          id: true,
          title: true,
          description: true,
        },
      },
    },
  });
  const clusters = clusterByTheme(
    actionPlans.map((actionPlan) => ({
      actionPlanId: actionPlan.id,
      findingId: actionPlan.finding.id,
      title: actionPlan.finding.title,
      description: actionPlan.finding.description,
    })),
    { minItems: 3, minSharedTerms: 2 },
  );

  return clusters.slice(0, 5).map((cluster) => {
    const ids = new Set(cluster.items.map((item) => item.actionPlanId));
    const highPriorityCount = actionPlans.filter((actionPlan) => ids.has(actionPlan.id) && actionPlan.priority === "High").length;
    return makeCard({
      cardVersion: "thematic-open-findings-v1",
      insightType: "risk_concentration",
      severity: severityByCount(cluster.items.length, highPriorityCount),
      confidence: "Medium",
      headline: `${cluster.items.length} open findings cluster around ${cluster.theme}.`,
      findings: {
        theme: cluster.theme,
        terms: cluster.terms,
        openFindingCount: cluster.items.length,
        highPriorityCount,
      },
      actionPlanIds: cluster.items.map((item) => item.actionPlanId),
      findingIds: cluster.items.map((item) => item.findingId),
      drillThroughFilter: { search: cluster.theme },
      supportingNumbers: [
        { label: "Open findings", value: cluster.items.length },
        { label: "High priority", value: highPriorityCount },
      ],
    });
  });
};

export const analyseHighPriorityEntityConcentration: InsightAnalyser = async (client = defaultPrisma) => {
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      priority: "High",
      status: { notIn: CLOSED_STATUSES },
    },
    select: {
      id: true,
      finding_id: true,
      action_plan_entities: {
        select: {
          entity_id: true,
          entity: { select: { code: true, full_name: true } },
        },
      },
    },
  });
  const map = new Map<string, { label: string; ids: string[]; findingIds: string[] }>();
  actionPlans.forEach((actionPlan) => {
    actionPlan.action_plan_entities.forEach(({ entity_id, entity }) => {
      const row = map.get(entity_id) ?? { label: `${entity.code} - ${entity.full_name}`, ids: [], findingIds: [] };
      row.ids.push(actionPlan.id);
      row.findingIds.push(actionPlan.finding_id);
      map.set(entity_id, row);
    });
  });
  const rows = [...map.entries()].map(([entityId, row]) => ({ entityId, ...row, count: row.ids.length }));
  const average = rows.length > 0 ? rows.reduce((sum, row) => sum + row.count, 0) / rows.length : 0;

  return rows
    .filter((row) => row.count >= Math.max(2, average * 1.5))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((row) =>
      makeCard({
        cardVersion: "entity-high-priority-concentration-v1",
        insightType: "risk_concentration",
        severity: row.count >= Math.max(3, average * 2) ? "High" : "Moderate",
        confidence: "High",
        headline: `${row.label} carries ${row.count} high-priority open action plans.`,
        findings: {
          entityId: row.entityId,
          entity: row.label,
          highPriorityOpenCount: row.count,
          portfolioAveragePerEntity: Number(average.toFixed(2)),
        },
        actionPlanIds: row.ids,
        findingIds: row.findingIds,
        drillThroughFilter: { priority: "High" },
        supportingNumbers: [
          { label: "High-priority open", value: row.count },
          { label: "Portfolio average", value: Number(average.toFixed(2)) },
        ],
      }),
    );
};

export const analyseHighPriorityOverdueDepartmentConcentration: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      priority: "High",
      status: { notIn: CLOSED_STATUSES },
      current_target_date: { lt: today },
    },
    select: {
      id: true,
      finding_id: true,
      department: true,
      action_plan_owners: {
        where: { is_primary: true },
        select: { user: { select: { department: true } } },
      },
    },
  });
  const map = new Map<string, { ids: string[]; findingIds: string[] }>();
  actionPlans.forEach((actionPlan) => {
    const department = primaryDepartment(actionPlan);
    const row = map.get(department) ?? { ids: [], findingIds: [] };
    row.ids.push(actionPlan.id);
    row.findingIds.push(actionPlan.finding_id);
    map.set(department, row);
  });
  const rows = [...map.entries()].map(([department, row]) => ({ department, ...row, count: row.ids.length }));
  const average = rows.length > 0 ? actionPlans.length / rows.length : 0;

  return rows
    .filter((row) => row.count >= Math.max(2, average * 1.5))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((row) =>
      makeCard({
        cardVersion: "department-high-overdue-concentration-v1",
        insightType: "risk_concentration",
        severity: row.count >= Math.max(3, average * 2) ? "High" : "Moderate",
        confidence: "High",
        headline: `${row.department} owns a concentration of ${row.count} high-priority overdue items.`,
        findings: {
          department: row.department,
          highPriorityOverdueCount: row.count,
          portfolioAveragePerDepartment: Number(average.toFixed(2)),
        },
        actionPlanIds: row.ids,
        findingIds: row.findingIds,
        drillThroughFilter: { department: row.department, priority: "High" },
        supportingNumbers: [
          { label: "High-priority overdue", value: row.count },
          { label: "Portfolio average", value: Number(average.toFixed(2)) },
        ],
      }),
    );
};

export const analyseOwnerLoadImbalance: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { notIn: CLOSED_STATUSES },
      action_plan_owners: { some: {} },
    },
    select: {
      id: true,
      finding_id: true,
      current_target_date: true,
      status: true,
      action_plan_owners: {
        where: { is_primary: true },
        select: { user_id: true, user: { select: { name: true } } },
      },
    },
  });
  const portfolioOverdueRate =
    actionPlans.length > 0
      ? actionPlans.filter((actionPlan) => actionPlan.current_target_date && actionPlan.current_target_date < today).length / actionPlans.length
      : 0;
  const map = new Map<string, { name: string; ids: string[]; findingIds: string[]; overdue: number }>();
  actionPlans.forEach((actionPlan) => {
    const owner = actionPlan.action_plan_owners[0];
    if (!owner) return;
    const row = map.get(owner.user_id) ?? { name: owner.user.name, ids: [], findingIds: [], overdue: 0 };
    row.ids.push(actionPlan.id);
    row.findingIds.push(actionPlan.finding_id);
    if (actionPlan.current_target_date && actionPlan.current_target_date < today) row.overdue += 1;
    map.set(owner.user_id, row);
  });
  const rows = [...map.entries()].map(([ownerId, row]) => ({
    ownerId,
    ...row,
    openCount: row.ids.length,
    overdueRate: row.ids.length > 0 ? row.overdue / row.ids.length : 0,
  }));
  const threshold = Math.max(1, percentile(rows.map((row) => row.openCount), 0.95));

  return rows
    .filter((row) => row.openCount >= threshold && row.overdueRate > portfolioOverdueRate)
    .sort((left, right) => right.openCount - left.openCount)
    .slice(0, 5)
    .map((row) =>
      makeCard({
        cardVersion: "owner-load-v1",
        insightType: "bottleneck",
        severity: row.overdueRate >= portfolioOverdueRate * 1.5 ? "High" : "Moderate",
        confidence: "High",
        headline: `${row.name} has ${row.openCount} open items and an above-average overdue rate.`,
        findings: {
          ownerId: row.ownerId,
          ownerName: row.name,
          openCount: row.openCount,
          overdueCount: row.overdue,
          ownerOverdueRate: Number((row.overdueRate * 100).toFixed(1)),
          portfolioOverdueRate: Number((portfolioOverdueRate * 100).toFixed(1)),
          topFivePercentThreshold: threshold,
        },
        actionPlanIds: row.ids,
        findingIds: row.findingIds,
        drillThroughFilter: { owner_id: row.ownerId },
        supportingNumbers: [
          { label: "Open items", value: row.openCount },
          { label: "Overdue", value: row.overdue },
          { label: "Owner overdue rate", value: `${(row.overdueRate * 100).toFixed(1)}%` },
        ],
      }),
    );
};

export const analyseStaleInProgressItems: InsightAnalyser = async (client = defaultPrisma) => {
  const cutoff = addDays(new Date(), -21);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: "InProgress",
    },
    select: {
      id: true,
      finding_id: true,
      priority: true,
      created_at: true,
      comments: { where: { is_deleted: false }, select: { created_at: true } },
      evidence: { where: { is_deleted: false }, select: { created_at: true } },
      status_history: { select: { changed_at: true } },
      target_date_revisions: { select: { revised_at: true } },
    },
  });
  const stale = actionPlans.filter(
    (actionPlan) =>
      latestActivityDate(actionPlan.created_at, [
        actionPlan.comments,
        actionPlan.evidence,
        actionPlan.status_history,
        actionPlan.target_date_revisions,
      ]) < cutoff,
  );
  if (stale.length === 0) return [];
  const highPriorityCount = stale.filter((actionPlan) => actionPlan.priority === "High").length;

  return [
    makeCard({
      cardVersion: "stale-in-progress-v1",
      insightType: "bottleneck",
      severity: severityByCount(stale.length, highPriorityCount),
      confidence: "High",
      headline: `${stale.length} in-progress action plans have had no activity for at least 21 days.`,
      findings: {
        staleCount: stale.length,
        highPriorityCount,
        inactivityDays: 21,
      },
      actionPlanIds: stale.map((actionPlan) => actionPlan.id),
      findingIds: stale.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { status: "InProgress" },
      supportingNumbers: [
        { label: "Stale items", value: stale.length },
        { label: "High priority", value: highPriorityCount },
        { label: "No activity", value: "21+ days" },
      ],
    }),
  ];
};

export const analyseClosedWithoutEvidence: InsightAnalyser = async (client = defaultPrisma) => {
  const cutoff = addDays(new Date(), -30);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: "Closed",
      status_history: { some: { to_status: "Closed", changed_at: { gte: cutoff } } },
      evidence: { none: { is_deleted: false } },
    },
    select: { id: true, finding_id: true, status_history: { where: { to_status: "Closed" }, select: { changed_at: true } } },
  });
  if (actionPlans.length === 0) return [];
  return [
    makeCard({
      cardVersion: "closed-without-evidence-v1",
      insightType: "quality_gap",
      severity: actionPlans.length >= 5 ? "High" : "Moderate",
      confidence: "High",
      headline: `${actionPlans.length} action plans were closed in the last 30 days without evidence.`,
      findings: {
        closedWithoutEvidenceCount: actionPlans.length,
        lookbackDays: 30,
      },
      actionPlanIds: actionPlans.map((actionPlan) => actionPlan.id),
      findingIds: actionPlans.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { status: "Closed" },
      supportingNumbers: [
        { label: "Closed without evidence", value: actionPlans.length },
        { label: "Lookback", value: "30 days" },
      ],
    }),
  ];
};

export const analyseClosedWithWeakRemarks: InsightAnalyser = async (client = defaultPrisma) => {
  const cutoff = addDays(new Date(), -30);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: "Closed",
      status_history: { some: { to_status: "Closed", changed_at: { gte: cutoff } } },
      evidence: { none: { is_deleted: false } },
    },
    select: { id: true, finding_id: true, closure_remarks: true },
  });
  const weak = actionPlans.filter((actionPlan) => {
    const remarks = actionPlan.closure_remarks?.trim() ?? "";
    return remarks.length < 30 || WEAK_REMARK_PATTERNS.some((pattern) => pattern.test(remarks));
  });
  if (weak.length === 0) return [];

  return [
    makeCard({
      cardVersion: "closed-weak-remarks-v1",
      insightType: "quality_gap",
      severity: weak.length >= 5 ? "High" : "Moderate",
      confidence: "High",
      headline: `${weak.length} recently closed action plans have weak closure remarks and no evidence.`,
      findings: {
        weakClosureRemarkCount: weak.length,
        weakLanguagePatterns: WEAK_REMARK_PATTERNS.map((pattern) => pattern.source),
        minimumRemarkLength: 30,
      },
      actionPlanIds: weak.map((actionPlan) => actionPlan.id),
      findingIds: weak.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { status: "Closed" },
      supportingNumbers: [
        { label: "Weak closures", value: weak.length },
        { label: "Minimum remark length", value: 30 },
      ],
    }),
  ];
};

export const analyseRepeatedReschedules: InsightAnalyser = async (client = defaultPrisma) => {
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      reschedule_count: { gt: 0 },
      original_target_date: { not: null },
      current_target_date: { not: null },
    },
    select: {
      id: true,
      finding_id: true,
      reschedule_count: true,
      original_target_date: true,
      current_target_date: true,
    },
  });
  const threshold = Math.max(1, percentile(actionPlans.map((actionPlan) => actionPlan.reschedule_count), 0.9));
  const repeated = actionPlans.filter(
    (actionPlan) =>
      actionPlan.reschedule_count >= threshold &&
      actionPlan.original_target_date &&
      actionPlan.current_target_date &&
      Math.abs(daysBetween(actionPlan.original_target_date, actionPlan.current_target_date)) > 90,
  );
  if (repeated.length === 0) return [];

  return [
    makeCard({
      cardVersion: "repeated-reschedules-v1",
      insightType: "quality_gap",
      severity: repeated.length >= 5 ? "High" : "Moderate",
      confidence: "High",
      headline: `${repeated.length} action plans sit in the top reschedule decile with target-date drift over 90 days.`,
      findings: {
        repeatedRescheduleCount: repeated.length,
        topDecileThreshold: threshold,
        minimumDateDriftDays: 90,
        maxDateDriftDays: Math.max(
          ...repeated.map((actionPlan) =>
            actionPlan.original_target_date && actionPlan.current_target_date
              ? Math.abs(daysBetween(actionPlan.original_target_date, actionPlan.current_target_date))
              : 0,
          ),
        ),
      },
      actionPlanIds: repeated.map((actionPlan) => actionPlan.id),
      findingIds: repeated.map((actionPlan) => actionPlan.finding_id),
      supportingNumbers: [
        { label: "Repeated reschedules", value: repeated.length },
        { label: "Top decile threshold", value: threshold },
        { label: "Date drift", value: ">90 days" },
      ],
    }),
  ];
};

export const analyseLikelyToSlip: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const cutoff = addDays(new Date(), -21);
  const dueSoonEnd = addDays(today, 14);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { in: ["NotStarted", "InProgress"] },
      current_target_date: { gte: today, lte: dueSoonEnd },
    },
    select: {
      id: true,
      finding_id: true,
      priority: true,
      created_at: true,
      comments: { where: { is_deleted: false }, select: { created_at: true } },
      evidence: { where: { is_deleted: false }, select: { created_at: true } },
      status_history: { select: { changed_at: true } },
      target_date_revisions: { select: { revised_at: true } },
    },
  });
  const likely = actionPlans.filter(
    (actionPlan) =>
      latestActivityDate(actionPlan.created_at, [
        actionPlan.comments,
        actionPlan.evidence,
        actionPlan.status_history,
        actionPlan.target_date_revisions,
      ]) < cutoff,
  );
  if (likely.length === 0) return [];
  const highPriorityCount = likely.filter((actionPlan) => actionPlan.priority === "High").length;

  return [
    makeCard({
      cardVersion: "likely-to-slip-v1",
      insightType: "forward_look",
      severity: highPriorityCount > 0 ? "High" : "Moderate",
      confidence: "High",
      headline: `${likely.length} action plans due in the next 14 days are likely to slip.`,
      findings: {
        likelyToSlipCount: likely.length,
        highPriorityCount,
        dueWithinDays: 14,
        inactivityDays: 21,
      },
      actionPlanIds: likely.map((actionPlan) => actionPlan.id),
      findingIds: likely.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { due_bucket: "next_14_days" },
      supportingNumbers: [
        { label: "Likely to slip", value: likely.length },
        { label: "High priority", value: highPriorityCount },
        { label: "Due window", value: "14 days" },
      ],
    }),
  ];
};

export const analyseApproachingVelocityWall: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const next30 = addDays(today, 30);
  const last30 = addDays(today, -30);
  const [dueSoon, closedRecently] = await Promise.all([
    client.action_plans.findMany({
      where: {
        is_deleted: false,
        status: { notIn: CLOSED_STATUSES },
        current_target_date: { gte: today, lte: next30 },
      },
      select: { id: true, finding_id: true, priority: true },
    }),
    client.status_history.findMany({
      where: {
        to_status: "Closed",
        changed_at: { gte: last30, lt: today },
        action_plan: { is_deleted: false },
      },
      select: { action_plan_id: true },
    }),
  ]);
  const capacity = closedRecently.length;
  if (dueSoon.length <= capacity || dueSoon.length === 0) return [];
  const highPriorityCount = dueSoon.filter((actionPlan) => actionPlan.priority === "High").length;

  return [
    makeCard({
      cardVersion: "velocity-wall-v1",
      insightType: "forward_look",
      severity: dueSoon.length >= capacity * 1.5 || highPriorityCount > 0 ? "High" : "Moderate",
      confidence: "Medium",
      headline: `${dueSoon.length} items fall due in 30 days, above the recent closure capacity of ${capacity}.`,
      findings: {
        dueNext30Days: dueSoon.length,
        closedLast30Days: capacity,
        highPriorityDueNext30Days: highPriorityCount,
        projectedExcess: dueSoon.length - capacity,
      },
      actionPlanIds: dueSoon.map((actionPlan) => actionPlan.id),
      findingIds: dueSoon.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { due_bucket: "next_30_days" },
      supportingNumbers: [
        { label: "Due next 30 days", value: dueSoon.length },
        { label: "Closed last 30 days", value: capacity },
        { label: "Projected excess", value: dueSoon.length - capacity },
      ],
    }),
  ];
};

export const analyseNextQuarterCalendarConcentration: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const nextQuarterEnd = addDays(today, 90);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { notIn: CLOSED_STATUSES },
      current_target_date: { gte: today, lte: nextQuarterEnd },
    },
    select: { id: true, finding_id: true, current_target_date: true },
  });
  const buckets = new Map<string, typeof actionPlans>();
  actionPlans.forEach((actionPlan) => {
    if (!actionPlan.current_target_date) return;
    const week = Math.floor(daysBetween(today, actionPlan.current_target_date) / 7);
    const key = `week-${week + 1}`;
    buckets.set(key, [...(buckets.get(key) ?? []), actionPlan]);
  });
  const [peakWeek, peakItems = []] = [...buckets.entries()].sort((left, right) => right[1].length - left[1].length)[0] ?? [];
  const share = actionPlans.length > 0 ? peakItems.length / actionPlans.length : 0;
  if (peakItems.length < 3 || share < 0.35) return [];

  return [
    makeCard({
      cardVersion: "next-quarter-calendar-concentration-v1",
      insightType: "forward_look",
      severity: share >= 0.5 ? "High" : "Moderate",
      confidence: "High",
      headline: `${peakItems.length} next-quarter target dates cluster in ${peakWeek}.`,
      findings: {
        nextQuarterItemCount: actionPlans.length,
        peakWeek,
        peakWeekItemCount: peakItems.length,
        peakWeekShare: Number((share * 100).toFixed(1)),
      },
      actionPlanIds: peakItems.map((actionPlan) => actionPlan.id),
      findingIds: peakItems.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { due_bucket: "next_quarter" },
      supportingNumbers: [
        { label: "Peak week items", value: peakItems.length },
        { label: "Next-quarter share", value: `${(share * 100).toFixed(1)}%` },
      ],
    }),
  ];
};

export const analyseDomainRescheduleOutliers: InsightAnalyser = async (client = defaultPrisma) => {
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      reschedule_count: { gt: 0 },
    },
    select: {
      id: true,
      finding_id: true,
      department: true,
      reschedule_count: true,
      action_plan_owners: { where: { is_primary: true }, select: { user: { select: { department: true } } } },
      finding: { select: { audit: { select: { audit_type: true } } } },
    },
  });
  if (actionPlans.length === 0) return [];
  const portfolioAverage =
    actionPlans.reduce((sum, actionPlan) => sum + actionPlan.reschedule_count, 0) / actionPlans.length;
  const groups = new Map<string, { label: string; ids: string[]; findingIds: string[]; total: number }>();
  actionPlans.forEach((actionPlan) => {
    const keys = [
      actionPlan.finding.audit?.audit_type ? `Audit type: ${actionPlan.finding.audit.audit_type}` : null,
      `Department: ${primaryDepartment(actionPlan)}`,
    ].filter((key): key is string => Boolean(key));
    keys.forEach((key) => {
      const row = groups.get(key) ?? { label: key, ids: [], findingIds: [], total: 0 };
      row.ids.push(actionPlan.id);
      row.findingIds.push(actionPlan.finding_id);
      row.total += actionPlan.reschedule_count;
      groups.set(key, row);
    });
  });
  const rows = [...groups.values()].map((row) => ({
    ...row,
    count: row.ids.length,
    average: row.ids.length > 0 ? row.total / row.ids.length : 0,
  }));

  return rows
    .filter((row) => row.count >= 3 && row.average >= portfolioAverage + 1)
    .sort((left, right) => right.average - left.average)
    .slice(0, 5)
    .map((row) =>
      makeCard({
        cardVersion: "domain-reschedule-outlier-v1",
        insightType: "anomaly",
        severity: row.average >= portfolioAverage * 2 ? "High" : "Moderate",
        confidence: "Medium",
        headline: `${row.label} is a reschedule outlier with an average of ${row.average.toFixed(1)} reschedules.`,
        findings: {
          group: row.label,
          itemCount: row.count,
          groupAverageReschedules: Number(row.average.toFixed(2)),
          portfolioAverageReschedules: Number(portfolioAverage.toFixed(2)),
        },
        actionPlanIds: row.ids,
        findingIds: row.findingIds,
        supportingNumbers: [
          { label: "Items", value: row.count },
          { label: "Group average", value: Number(row.average.toFixed(2)) },
          { label: "Portfolio average", value: Number(portfolioAverage.toFixed(2)) },
        ],
      }),
    );
};

export const analyseOwnersWithoutRecentActivity: InsightAnalyser = async (client = defaultPrisma) => {
  const cutoff = addDays(new Date(), -30);
  const users = await client.users.findMany({
    where: {
      action_plan_owner_assignments: {
        some: { action_plan: { is_deleted: false, status: { notIn: CLOSED_STATUSES } } },
      },
    },
    select: {
      id: true,
      name: true,
      action_plan_owner_assignments: {
        where: { action_plan: { is_deleted: false, status: { notIn: CLOSED_STATUSES } } },
        select: { action_plan: { select: { id: true, finding_id: true } } },
      },
      comments: { where: { is_deleted: false, created_at: { gte: cutoff } }, select: { id: true } },
      evidence_uploaded: { where: { is_deleted: false, created_at: { gte: cutoff } }, select: { id: true } },
      status_changes: { where: { changed_at: { gte: cutoff } }, select: { id: true } },
    },
  });
  const inactive = users.filter(
    (user) => user.comments.length + user.evidence_uploaded.length + user.status_changes.length === 0,
  );
  if (inactive.length === 0) return [];
  const actionPlanIds = inactive.flatMap((user) => user.action_plan_owner_assignments.map((assignment) => assignment.action_plan.id));
  const findingIds = inactive.flatMap((user) => user.action_plan_owner_assignments.map((assignment) => assignment.action_plan.finding_id));

  return [
    makeCard({
      cardVersion: "owners-without-recent-activity-v1",
      insightType: "anomaly",
      severity: inactive.length >= 5 ? "High" : "Moderate",
      confidence: "High",
      headline: `${inactive.length} owners have assigned open action plans but no recent activity.`,
      findings: {
        inactiveOwnerCount: inactive.length,
        lookbackDays: 30,
        owners: inactive.map((user) => ({ id: user.id, name: user.name, openAssignedCount: user.action_plan_owner_assignments.length })),
      },
      actionPlanIds,
      findingIds,
      supportingNumbers: [
        { label: "Inactive owners", value: inactive.length },
        { label: "Affected open items", value: actionPlanIds.length },
        { label: "No activity", value: "30 days" },
      ],
    }),
  ];
};

export const analyseUnusualClosureSpeed: InsightAnalyser = async (client = defaultPrisma) => {
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: "Closed",
      status_history: { some: { to_status: "Closed" } },
    },
    select: {
      id: true,
      finding_id: true,
      created_at: true,
      status_history: { where: { to_status: "Closed" }, orderBy: { changed_at: "asc" }, take: 1, select: { changed_at: true } },
    },
  });
  const fast = actionPlans.filter((actionPlan) => {
    const closedAt = actionPlan.status_history[0]?.changed_at;
    return closedAt ? daysBetween(actionPlan.created_at, closedAt) < 3 : false;
  });
  if (fast.length === 0) return [];

  return [
    makeCard({
      cardVersion: "unusual-closure-speed-v1",
      insightType: "anomaly",
      severity: fast.length >= 5 ? "Moderate" : "Low",
      confidence: "High",
      headline: `${fast.length} action plans were closed within three days of creation.`,
      findings: {
        unusuallyFastClosureCount: fast.length,
        closureWindowDays: 3,
      },
      actionPlanIds: fast.map((actionPlan) => actionPlan.id),
      findingIds: fast.map((actionPlan) => actionPlan.finding_id),
      drillThroughFilter: { status: "Closed" },
      supportingNumbers: [
        { label: "Fast closures", value: fast.length },
        { label: "Closure window", value: "<3 days" },
      ],
    }),
  ];
};

export const analyseThemesMitigatedLast90Days: InsightAnalyser = async (client = defaultPrisma) => {
  const cutoff = addDays(new Date(), -90);
  const actionPlans = await client.action_plans.findMany({
    where: {
      is_deleted: false,
      status: "Closed",
      status_history: { some: { to_status: "Closed", changed_at: { gte: cutoff } } },
      evidence: { some: { is_deleted: false } },
    },
    select: {
      id: true,
      finding: { select: { id: true, title: true, description: true } },
    },
  });
  const clusters = clusterByTheme(
    actionPlans.map((actionPlan) => ({
      actionPlanId: actionPlan.id,
      findingId: actionPlan.finding.id,
      title: actionPlan.finding.title,
      description: actionPlan.finding.description,
    })),
    { minItems: 3, minSharedTerms: 2 },
  );

  return clusters.slice(0, 5).map((cluster) =>
    makeCard({
      cardVersion: "themes-mitigated-v1",
      insightType: "risk_mitigated",
      severity: "Low",
      confidence: "Medium",
      headline: `${cluster.items.length} evidence-backed closures mitigated the ${cluster.theme} theme.`,
      findings: {
        theme: cluster.theme,
        terms: cluster.terms,
        closedWithEvidenceCount: cluster.items.length,
        lookbackDays: 90,
      },
      actionPlanIds: cluster.items.map((item) => item.actionPlanId),
      findingIds: cluster.items.map((item) => item.findingId),
      drillThroughFilter: { status: "Closed", search: cluster.theme },
      supportingNumbers: [
        { label: "Closed with evidence", value: cluster.items.length },
        { label: "Lookback", value: "90 days" },
      ],
    }),
  );
};

export const analyseVelocityTrend: InsightAnalyser = async (client = defaultPrisma) => {
  const today = startOfToday();
  const sixMonthsAgo = addDays(today, -180);
  const closedHistory = await client.status_history.findMany({
    where: {
      to_status: "Closed",
      changed_at: { gte: sixMonthsAgo, lte: today },
      action_plan: { is_deleted: false },
    },
    select: {
      changed_at: true,
      action_plan: { select: { id: true, finding_id: true } },
    },
  });
  if (closedHistory.length === 0) return [];
  const windows = Array.from({ length: 6 }, (_item, index) => {
    const start = addDays(today, -180 + index * 30);
    const end = addDays(start, 30);
    const items = closedHistory.filter((history) => history.changed_at >= start && history.changed_at < end);
    return { start, end, count: items.length, items };
  });
  const inflections = windows
    .slice(1)
    .map((window, index) => ({ window, previous: windows[index], change: window.count - windows[index].count }))
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change));
  const notable = inflections[0];
  const latestWindow = windows[windows.length - 1];
  const related = notable && Math.abs(notable.change) >= 2 ? notable.window.items : latestWindow.items;

  return [
    makeCard({
      cardVersion: "velocity-trend-v1",
      insightType: "risk_mitigated",
      severity: "Low",
      confidence: "High",
      headline:
        notable && Math.abs(notable.change) >= 2
          ? `Closure velocity changed by ${notable.change} items in a rolling 30-day window.`
          : `${latestWindow.count} action plans were closed in the most recent 30-day window.`,
      findings: {
        rollingWindowDays: 30,
        windowCounts: windows.map((window) => ({
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          closed: window.count,
        })),
        notableChange: notable?.change ?? 0,
      },
      actionPlanIds: related.map((history) => history.action_plan.id),
      findingIds: related.map((history) => history.action_plan.finding_id),
      drillThroughFilter: { status: "Closed" },
      supportingNumbers: [
        { label: "Latest 30-day closures", value: latestWindow.count },
        { label: "Notable change", value: notable?.change ?? 0 },
      ],
    }),
  ];
};

export const AI_INSIGHT_ANALYSERS = [
  analyseThematicOpenFindingClusters,
  analyseHighPriorityEntityConcentration,
  analyseHighPriorityOverdueDepartmentConcentration,
  analyseOwnerLoadImbalance,
  analyseStaleInProgressItems,
  analyseClosedWithoutEvidence,
  analyseClosedWithWeakRemarks,
  analyseRepeatedReschedules,
  analyseLikelyToSlip,
  analyseApproachingVelocityWall,
  analyseNextQuarterCalendarConcentration,
  analyseDomainRescheduleOutliers,
  analyseOwnersWithoutRecentActivity,
  analyseUnusualClosureSpeed,
  analyseThemesMitigatedLast90Days,
  analyseVelocityTrend,
] satisfies InsightAnalyser[];

export async function runAiInsightsAnalysers(client: PrismaClient = defaultPrisma) {
  const results = await Promise.all(AI_INSIGHT_ANALYSERS.map((analyser) => analyser(client)));
  return results.flat().sort((left, right) => {
    const severityOrder: Record<InsightSeverity, number> = { High: 0, Moderate: 1, Low: 2 };
    return severityOrder[left.severity] - severityOrder[right.severity] || left.insightType.localeCompare(right.insightType);
  });
}
